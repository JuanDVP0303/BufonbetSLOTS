/**
 * HUD del modo escritorio/horizontal: UNA sola fila abajo, superpuesta al juego,
 * sobre una franja casi transparente (sin barra de fondo):
 *
 *   INFO MENÚ SONIDO · CRÉDITO · − APUESTA + · GIRAR · AUTO TURBO · (ayuda) · GANANCIA
 *
 * + banner "GANASTE" (premio normal) montado sobre el borde inferior del panel.
 *
 * Se construye UNA vez; `layout()` solo reposiciona/redimensiona (resize sin
 * recrear objetos). Fondos de cajas y botones caramelo = texturas horneadas
 * (BakedImage, un quad cada una; se redibujan solo si cambia tamaño/estado). Sin
 * tweens infinitos: el brillo del GIRAR y su giro "ocupado" se animan en `tick()`.
 * Los montos son BitmapText (sin regenerar texturas canvas en cada cambio).
 */
import Phaser from "phaser";
import { TEX } from "../constants";
import { CONFIG_DESKTOP, DESKTOP_FONT } from "./configDesktop";
import type { DesktopLayout, Rect } from "./layoutDesktop";
import { BakedImage, ensureFadeTexture, paintCandyButton, paintValuePill, paintWinBanner, type Glyph } from "./paintDesktop";

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
const FADE_TEX = "tex-hud-fade";

/**
 * Quita los tweens de un objeto de forma SEGURA: `remove()` difiere la baja si el
 * TweenManager está procesando (a diferencia de killTweensOf(), que destruye el
 * tween en el acto y rompe si se llama desde el onComplete de ese mismo tween).
 */
export function removeTweensOf(scene: Phaser.Scene, target: object) {
  for (const t of scene.tweens.getTweensOf(target)) t.remove();
}

interface ButtonOpts {
  glyph: Glyph;
  tooltip?: string;
  onClick?: () => void; // sin onClick = stub (visible, con tooltip, sin cursor de mano)
  texOn?: string;
  texOff?: string;
  toggle?: boolean; // tiene estado activo/inactivo (se marca con halo, no apagándolo)
}

/** Botón con hover (escala), press (escala), estado activo/inactivo y deshabilitado. */
class HudButton {
  readonly root: Phaser.GameObjects.Container;
  readonly visual: Phaser.GameObjects.Container;
  private zone: Phaser.GameObjects.Zone;
  private img?: Phaser.GameObjects.Image;
  private baked?: BakedImage;
  private tip?: Phaser.GameObjects.Text;
  private halo?: Phaser.GameObjects.Image;
  private size = 0;
  private res = 0;
  private active = true;
  private enabled = true;
  private hovered = false;
  private texOn?: string;
  private texOff?: string;
  // Tweens propios de escala/tooltip (cortos): se reemplazan, no se acumulan.
  private scaleTween?: Phaser.Tweens.Tween;
  private tipTween?: Phaser.Tweens.Tween;

  constructor(private scene: Phaser.Scene, private opts: ButtonOpts) {
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
      this.baked = new BakedImage(scene, 4);
      this.visual.add(this.baked.image);
    }
    this.zone = scene.add.zone(0, 0, 10, 10);
    this.root.add(this.zone);
    const interactive = !!opts.onClick;
    this.zone.setInteractive({ useHandCursor: interactive });
    if (opts.tooltip) {
      this.tip = scene.add
        .text(0, 0, opts.tooltip, { fontFamily: DESKTOP_FONT, fontStyle: "700", color: "#ffffff", backgroundColor: "#140828e6" })
        .setOrigin(0.5, 1)
        .setAlpha(0);
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

  place(cx: number, cy: number, size: number, res: number, tipSize: number) {
    this.root.setPosition(cx, cy);
    if (size === this.size && res === this.res) return;
    this.size = size;
    this.res = res;
    this.zone.setSize(size * 1.06, size * 1.06); // también ajusta el hitArea
    this.halo?.setDisplaySize(size * 1.9, size * 1.9);
    if (this.tip) {
      const px = Math.max(10, Math.round(tipSize));
      this.tip.setFontSize(px).setPadding(Math.round(px * 0.6), Math.round(px * 0.28)).setResolution(res);
      this.tip.setPosition(0, -size / 2 - px * 0.6);
    }
    this.redraw();
  }

  private redraw() {
    const s = this.size;
    if (!s) return;
    // Activo = halo de luz detrás (inactivo NO se apaga: se vería deshabilitado).
    this.halo?.setVisible(this.active).setAlpha(BTN.activeHaloAlpha);
    if (this.img) {
      const key = this.active ? this.texOn! : this.texOff!;
      this.img.setTexture(key);
      const src = this.img.texture.getSourceImage();
      this.img.setScale(Math.min(s / src.width, s / src.height));
      return;
    }
    const { glyph, toggle = false } = this.opts;
    const on = this.active;
    this.baked!.draw(s, s, this.res, `${on}`, (ctx) => paintCandyButton(ctx, s, glyph, on, toggle));
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

/** Caja CRÉDITO / APUESTA / GANANCIA: pastilla horneada (con su etiqueta) + monto BitmapText. */
class ValueBox {
  readonly root: Phaser.GameObjects.Container;
  private bg: BakedImage;
  readonly value: Phaser.GameObjects.BitmapText;
  private maxW = 100;
  private baseScale = 1;

  constructor(private scene: Phaser.Scene, private label: string, private labelColor: string, gold: boolean) {
    this.root = scene.add.container(0, 0).setDepth(D.depth.hud);
    this.bg = new BakedImage(scene, 4);
    this.value = scene.add.bitmapText(0, 0, D.text.bitmapFontKey, "", 32).setOrigin(0.5);
    if (gold) this.value.setTint(D.text.goldTop, D.text.goldTop, D.text.goldBottom, D.text.goldBottom);
    this.root.add([this.bg.image, this.value]);
  }

  place(r: Rect, labelSize: number, valueSize: number, res: number) {
    this.root.setPosition(r.x + r.w / 2, r.y + r.h / 2);
    this.bg.draw(r.w, r.h, res, `${labelSize.toFixed(2)}`, (ctx, w, h) => paintValuePill(ctx, w, h, this.label, this.labelColor, labelSize));
    this.value.setFontSize(Math.round(valueSize)).setPosition(0, r.h * 0.16);
    this.maxW = r.w * 0.86;
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
    this.root.setScale(this.baseScale);
    this.scene.tweens.add({ targets: this.root, scale: this.baseScale * 1.06, duration: 120, yoyo: true, ease: "Sine.easeOut" });
  }
}

export class DesktopHud {
  private strip: Phaser.GameObjects.Image;
  private hint: Phaser.GameObjects.Text;
  private info: HudButton;
  private menu: HudButton;
  private sound: HudButton;
  private turbo: HudButton;
  private auto: HudButton;
  readonly spin: HudButton;
  readonly minus: HudButton;
  private plus: HudButton;
  readonly spinGlow: Phaser.GameObjects.Image;
  private busy = false;
  private busySince = 0;
  readonly credit: ValueBox;
  readonly bet: ValueBox;
  readonly win: ValueBox;
  // Banner "GANASTE" (premio normal): tamaño fijo por layout, contenido centrado.
  private banner: Phaser.GameObjects.Container;
  private bannerBg: BakedImage;
  private bannerLabel: Phaser.GameObjects.Text;
  private bannerValue: Phaser.GameObjects.BitmapText;
  private bannerW = 400;
  private bannerH = 50;
  private res = 1;
  private L?: DesktopLayout;

  constructor(private scene: Phaser.Scene, cb: HudCallbacks, accent: number) {
    ensureFadeTexture(scene, FADE_TEX);
    this.strip = scene.add.image(0, 0, FADE_TEX).setOrigin(0, 0).setAlpha(D.controls.stripAlpha).setDepth(D.depth.hud - 2);
    this.hint = scene.add
      .text(0, 0, "", { fontFamily: DESKTOP_FONT, fontStyle: "700", color: "#ffffff", align: "center" })
      .setOrigin(0.5)
      .setAlpha(D.hint.alpha)
      .setShadow(0, 1, "#000000", 3, true, true)
      .setDepth(D.depth.hud);

    this.info = new HudButton(scene, { glyph: "info", tooltip: "INFO", onClick: cb.onInfo });
    // MENÚ: sin funcionalidad todavía (igual que antes): visible, con tooltip, sin acción.
    this.menu = new HudButton(scene, { glyph: "menu", tooltip: "MENÚ" });
    this.sound = new HudButton(scene, { glyph: "sound", tooltip: "SONIDO (M)", onClick: cb.onMusic, texOn: TEX.musicOn, texOff: TEX.musicOff, toggle: true });
    this.turbo = new HudButton(scene, { glyph: "turbo", tooltip: "TURBO", onClick: cb.onTurbo, texOn: TEX.turboOn, texOff: TEX.turboOff, toggle: true });
    this.auto = new HudButton(scene, { glyph: "auto", tooltip: "AUTO", onClick: cb.onAuto, texOn: TEX.autoOn, texOff: TEX.autoOff, toggle: true });

    // Brillo del giro: sprite pre-renderizado (TEX.glow) en ADD, animado en tick().
    this.spinGlow = scene.add
      .image(0, 0, TEX.glow)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(accent)
      .setAlpha(D.spin.glowAlphaMin)
      .setDepth(D.depth.hud - 1);
    this.spin = new HudButton(scene, { glyph: "spin", onClick: cb.onSpin, texOn: TEX.spinBtn, texOff: TEX.spinBtn });
    this.spin.root.setDepth(D.depth.hud + 1);

    this.minus = new HudButton(scene, { glyph: "minus", onClick: () => cb.onBet(-1), texOn: TEX.betMinus, texOff: TEX.betMinus });
    this.plus = new HudButton(scene, { glyph: "plus", onClick: () => cb.onBet(1), texOn: TEX.betPlus, texOff: TEX.betPlus });

    const lc = D.box.labelColors;
    this.credit = new ValueBox(scene, "CRÉDITO", lc.credit, false);
    this.bet = new ValueBox(scene, "APUESTA", lc.bet, false);
    this.win = new ValueBox(scene, "GANANCIA", lc.win, true);

    // Banner GANASTE (reutilizado en cada premio: setText, nunca se recrea).
    this.bannerBg = new BakedImage(scene, 6);
    this.bannerLabel = scene.add
      .text(0, 0, "GANASTE", { fontFamily: DESKTOP_FONT, fontStyle: "800", color: "#ffffff" })
      .setOrigin(1, 0.5)
      .setStroke("#2b1604", 5)
      .setShadow(0, 2, "#000000", 4, true, true);
    this.bannerValue = scene.add
      .bitmapText(0, 0, D.text.bitmapFontKey, "", 40)
      .setOrigin(0, 0.5)
      .setTint(D.text.goldTop, D.text.goldTop, D.text.goldBottom, D.text.goldBottom);
    this.banner = scene.add
      .container(0, 0, [this.bannerBg.image, this.bannerLabel, this.bannerValue])
      .setDepth(D.depth.winBanner)
      .setVisible(false);
  }

  /** Reposiciona/redimensiona todo según el layout (sin recrear objetos). */
  layout(L: DesktopLayout, res: number) {
    this.L = L;
    this.res = res;
    const c = L.controls;
    this.strip.setPosition(c.strip.x, c.strip.y).setDisplaySize(c.strip.w, c.strip.h);

    // Ayuda de turbo: 2 líneas integradas en la fila, o 1 línea encima de CRÉDITO.
    this.hint
      .setText(c.hint.twoLines ? D.hint.lines.join("\n") : D.hint.lines.join(" "))
      .setFontSize(Math.max(9, Math.round(c.hint.size)))
      .setLineSpacing(-c.hint.size * 0.15)
      .setResolution(res)
      .setScale(1)
      .setPosition(c.hint.cx, c.hint.cy);
    if (this.hint.width > c.hint.maxW) this.hint.setScale(c.hint.maxW / this.hint.width);

    const tip = c.tooltipSize;
    this.info.place(c.info.cx, c.info.cy, c.info.size, res, tip);
    this.menu.place(c.menu.cx, c.menu.cy, c.menu.size, res, tip);
    this.sound.place(c.sound.cx, c.sound.cy, c.sound.size, res, tip);
    this.turbo.place(c.turbo.cx, c.turbo.cy, c.turbo.size, res, tip);
    this.auto.place(c.auto.cx, c.auto.cy, c.auto.size, res, tip);
    this.minus.place(c.minus.cx, c.minus.cy, c.minus.size, res, tip);
    this.plus.place(c.plus.cx, c.plus.cy, c.plus.size, res, tip);
    this.spin.place(c.spin.cx, c.spin.cy, c.spin.r * 2, res, tip);
    const glowD = c.spin.r * 2 * D.spin.glowScale;
    this.spinGlow.setPosition(c.spin.cx, c.spin.cy).setDisplaySize(glowD, glowD);
    this.credit.place(c.credit, c.labelSize, c.valueSize, res);
    this.bet.place(c.bet, c.labelSize, c.valueSize, res);
    this.win.place(c.win, c.labelSize, c.valueSize, res);

    // Banner GANASTE: tamaño fijo para este layout (el fondo no se re-hornea en el conteo).
    const B = D.winBanner;
    this.bannerH = L.winBanner.h;
    this.bannerW = Math.min(L.winBanner.maxW, this.bannerH * 9.5);
    this.banner.setPosition(L.winBanner.cx, L.winBanner.cy);
    this.bannerBg.draw(this.bannerW, this.bannerH, res, "", (ctx, w, h) => paintWinBanner(ctx, w, h));
    this.bannerLabel
      .setFontSize(Math.round(this.bannerH * B.labelSize))
      .setStroke("#2b1604", Math.max(2, Math.round(this.bannerH * 0.08)))
      .setResolution(res);
    this.bannerValue.setFontSize(Math.round(this.bannerH * B.valueSize));
    this.fitBanner();
  }

  /** Nitidez de los Text del HUD al cambiar la resolución interna (zoom de cámara). */
  setTextResolution(res: number) {
    if (this.L && res !== this.res) this.layout(this.L, res);
  }

  /** Animaciones continuas baratas (sin tweens infinitos): brillo del GIRAR / giro ocupado. */
  tick(time: number) {
    if (this.busy) {
      if (!this.busySince) this.busySince = time;
      this.spin.visual.setAngle((((time - this.busySince) / D.spin.busyRotateMs) * 360) % 360);
      return;
    }
    const S = D.spin;
    const t = 0.5 - 0.5 * Math.cos((time / S.glowPulseMs) * Math.PI);
    this.spinGlow.setAlpha(S.glowAlphaMin + (S.glowAlphaMax - S.glowAlphaMin) * t);
  }

  /** Estado "girando": giro y −/+ deshabilitados, brillo apagado, icono rotando. */
  setBusy(busy: boolean) {
    if (this.busy === busy) return;
    this.busy = busy;
    this.busySince = 0;
    this.spin.setEnabled(!busy);
    this.minus.setEnabled(!busy);
    this.plus.setEnabled(!busy);
    this.spin.visual.setAlpha(busy ? D.spin.busyAlpha : 1);
    this.spinGlow.setVisible(!busy);
    if (!busy) this.spin.visual.setAngle(0);
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

  private fitBanner() {
    const h = this.bannerH;
    const gap = h * 0.22;
    this.bannerValue.setScale(1);
    const labelW = this.bannerLabel.width;
    const maxValueW = this.bannerW - labelW - gap - h * 1.1;
    if (this.bannerValue.width > maxValueW && this.bannerValue.width > 0) this.bannerValue.setScale(maxValueW / this.bannerValue.width);
    const total = labelW + gap + this.bannerValue.width * this.bannerValue.scaleX;
    this.bannerLabel.setX(-total / 2 + labelW);
    this.bannerValue.setX(-total / 2 + labelW + gap);
  }

  /** Muestra el banner GANASTE y devuelve el destino del conteo animado. */
  showWinBanner(): TextLike {
    removeTweensOf(this.scene, this.banner);
    this.banner.setVisible(true).setAlpha(1).setScale(0.6);
    this.scene.tweens.add({ targets: this.banner, scale: 1, duration: 320, ease: "Back.easeOut" });
    return {
      setText: (v: string) => {
        this.bannerValue.setText(v);
        this.fitBanner();
      },
    };
  }

  hideWinBanner() {
    removeTweensOf(this.scene, this.banner);
    this.banner.setVisible(false);
  }
}
