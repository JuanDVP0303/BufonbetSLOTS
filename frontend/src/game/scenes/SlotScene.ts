import Phaser from "phaser";
import { SYMBOLS, PAYLINES, BIG_WIN_MULTIPLIER, TEX } from "../constants";
import { Reel } from "../Reel";
import { sfx } from "../sfx";
import type { SpinResponse } from "../../api/spinApi";
import type { RuntimeConfig } from "../config";

/** Botón redondo con estado activo/inactivo (turbo, autoplay). */
interface Toggle {
  setActive(on: boolean): void;
}

/** Convierte "#ffd23f" (o "#fc0") a 0xffd23f; devuelve fallback si no es válido. */
function hexToNum(hex: string | undefined, fallback: number): number {
  if (!hex) return fallback;
  let m = hex.replace("#", "");
  if (m.length === 3) m = m.split("").map((c) => c + c).join("");
  const n = parseInt(m, 16);
  return Number.isNaN(n) ? fallback : n;
}

/**
 * Escena principal del slot. RESPONSIVE: no asume un tamaño fijo — lee
 * `this.scale` (tamaño real del lienzo) y centra la rejilla, dejando que el
 * fondo del casino llene toda la pantalla (en PC se ve completo, no como un
 * teléfono). Al redimensionar la ventana se reinicia la escena para recalcular.
 */
export class SlotScene extends Phaser.Scene {
  private runtime!: RuntimeConfig;
  private reels: Reel[] = [];
  private busy = false;

  // Tamaño del lienzo y geometría calculada del layout.
  private W = 540;
  private H = 960;
  private cols = 3;
  private rows = 3;
  // Líneas de pago del casino actual (una fila por rodillo). Vienen del backend;
  // si faltan (casino antiguo) se cae a las PAYLINES estáticas del 3x3.
  private paylines: number[][] = [];
  private size = 150;
  private gridX = 45;
  private gridY = 170;
  private gridW = 450;
  private gridH = 450;
  private panelPad = 20; // margen entre la rejilla y el borde de caramelo
  private portrait = false; // móvil (vertical) vs escritorio (horizontal)
  private logoY = 70;
  private logoX = 270; // posición horizontal del logo (centro en móvil, esquina en PC)
  private logoAngle = 0; // inclinación del logo (para seguir el borde en la esquina)
  private logoMaxW = 360; // tamaño máximo del logo (según orientación)
  private logoMaxH = 120;
  private topInfoY = 60; // franja superior (GANANCIA en PC, donde antes iba el logo)
  private winRowY = 60; // fila de GANANCIA/GANASTE (móvil: pegada bajo la rejilla)
  private winMaxW = 400; // ancho máximo del texto "GANASTE" (para que no se desborde)
  private prizeBannerImg?: Phaser.GameObjects.Image; // banner de premio (solo visible al ganar)
  private bannerY = 700;
  private buttonY = 850;
  private barTop = 800;

  private winGfx!: Phaser.GameObjects.Graphics;
  private winText!: Phaser.GameObjects.Text;
  private button!: Phaser.GameObjects.Image;
  private buttonLabel!: Phaser.GameObjects.Text;
  private pulse?: Phaser.Tweens.Tween;
  private transient: Phaser.GameObjects.GameObject[] = [];

  // Estado económico (mostrado en la barra inferior, dentro del juego).
  private bet = 100;
  private betLevels: number[] = [];
  private betMin = 1;
  private betMax = 1_000_000;
  private balance = 0;
  private currency = "USD";
  private curSymbol = "$";
  private curExp = 2;
  private accent = 0xffd23f; // color predominante del tema (numérico, para gráficos)
  private accentHex = "#ffd23f"; // mismo color en texto (para estilos de Text)
  private balanceValue!: Phaser.GameObjects.Text;
  private betValue!: Phaser.GameObjects.Text;
  private winValue!: Phaser.GameObjects.Text;
  private winGroup!: Phaser.GameObjects.Container; // GANANCIA (se oculta al mostrar el banner)

  // Turbo (frenado rápido) y autoplay (giros automáticos).
  private turbo = false;
  private autoOn = false;
  // Tiradas gratis: cuando remaining>0 el juego encadena solo las tiradas libres.
  private freeSpinsRemaining = 0;
  private freeMultiplier = 1;
  private fsBadge?: Phaser.GameObjects.Container;
  private fsBadgeText?: Phaser.GameObjects.Text;
  private turboToggle?: Toggle;
  private autoToggle?: Toggle;
  // Temporizador del PRÓXIMO giro automático. Se guarda para poder CANCELARLO al
  // pulsar "parar" (si no, el giro ya programado saltaba igual y "no se detenía").
  private autoTimer?: Phaser.Time.TimerEvent;

  // Música de fondo del casino (opcional) y su botón de encendido/apagado.
  private music?: Phaser.Sound.BaseSound;
  private musicBtn?: Phaser.GameObjects.Image;
  private musicMuted = false;
  private musicX = 0;
  private musicY = 0;
  private musicR = 24;

  constructor() {
    super("Slot");
  }

  create() {
    this.runtime = this.registry.get("runtime") as RuntimeConfig;
    this.cols = this.runtime.grid?.cols ?? 3;
    this.rows = this.runtime.grid?.rows ?? 3;
    this.paylines = this.runtime.theme?.paylines?.length ? this.runtime.theme.paylines : PAYLINES;
    this.musicMuted = (this.registry.get("musicMuted") as boolean) ?? false;

    // Apuesta/saldo persisten entre reinicios (resize) vía registry.
    this.betLevels = this.runtime.betLevels ?? [];
    this.betMin = this.runtime.betMin ?? 1;
    this.betMax = this.runtime.betMax ?? 1_000_000;
    this.bet = (this.registry.get("bet") as number) ?? this.runtime.betAmount;
    this.balance = (this.registry.get("balance") as number) ?? this.runtime.balance ?? 0;
    this.currency = this.runtime.currency ?? "USD";
    this.curSymbol = this.runtime.currencySymbol ?? "$";
    this.curExp = this.runtime.currencyExponent ?? 2;
    this.accent = hexToNum(this.runtime.theme?.accent_color, 0xffd23f);
    this.accentHex = `#${this.accent.toString(16).padStart(6, "0")}`;
    this.turbo = (this.registry.get("turbo") as boolean) ?? false;

    // Phaser REUTILIZA la instancia de la escena en scene.restart() (p. ej. al
    // redimensionar): los campos de clase NO se reinicializan solos. Reseteamos el
    // estado del autoplay a mano para que no quede "pegado" en ON tras un resize.
    this.autoOn = false;
    this.busy = false;
    this.autoTimer?.remove(false);
    this.autoTimer = undefined;

    this.computeLayout();
    this.drawBackground();
    this.drawPanel();
    this.buildReels();

    this.winGfx = this.add.graphics().setDepth(5);
    this.drawTitle();
    this.drawBanner();

    this.winText = this.add
      .text(this.W / 2, this.bannerY, "", {
        fontFamily: "Arial, sans-serif",
        fontSize: `${Math.round(this.size * (this.portrait ? 0.22 : 0.16))}px`,
        fontStyle: "bold",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 7,
        align: "center",
      })
      .setOrigin(0.5)
      .setShadow(0, 0, this.accentHex, 14, true, true)
      .setDepth(6);

    this.buildControls();
    this.setupMusic();

    this.input.keyboard?.on("keydown-SPACE", () => this.onSpin());

    // Recalcular al redimensionar la ventana (solo si no está girando).
    this.scale.on("resize", this.onResize, this);
    this.events.once("shutdown", () => {
      this.scale.off("resize", this.onResize, this);
      this.music?.stop();
    });
  }

  private onResize(size: Phaser.Structs.Size) {
    if (this.busy) return;
    if (Math.abs(size.width - this.W) < 2 && Math.abs(size.height - this.H) < 2) return;
    this.scene.restart();
  }

  update(_time: number, dtMs: number) {
    for (const reel of this.reels) {
      reel.update(dtMs);
      reel.render();
    }
  }

  // -------------------------------------------------------------------- //
  // Layout                                                                //
  // -------------------------------------------------------------------- //
  private computeLayout() {
    const W = this.scale.width;
    const H = this.scale.height;
    this.W = W;
    this.H = H;
    this.portrait = H > W;

    if (this.portrait) {
      // MÓVIL (vertical): logo grande arriba, rejilla a TODO el ancho, controles
      // apilados debajo (giro centrado + crédito/apuesta + fila de iconos).
      const headerH = Math.max(96, H * 0.15);
      const footerH = Math.max(190, H * 0.27);
      const availH = H - headerH - footerH;
      // Franja para GANANCIA/GANASTE debajo de la rejilla, con algo de separación de
      // los rieles pero sin dejar un hueco enorme.
      const winZoneH = Math.max(64, H * 0.09);
      const gridArea = availH - winZoneH;
      const maxGridW = W * 0.98;
      this.size = Math.floor(Math.min(maxGridW / this.cols, gridArea / this.rows, 200));
      this.gridW = this.size * this.cols;
      this.gridH = this.size * this.rows;
      this.gridX = (W - this.gridW) / 2;
      // Conjunto (rejilla + franja de ganancia) centrado verticalmente en el área.
      this.gridY = headerH + Math.max(0, (gridArea - this.gridH) / 2);
      // Separada de los rieles (~65% de la franja hacia abajo).
      this.winRowY = this.gridY + this.gridH + winZoneH * 0.65;
      this.panelPad = Math.round(this.size * 0.12);
      // MÓVIL: logo grande y centrado arriba (como la referencia).
      this.logoY = Math.max(headerH * 0.5, this.gridY - this.panelPad - headerH * 0.2);
      this.logoX = W / 2;
      this.logoAngle = 0;
      this.logoMaxW = W * 0.95;
      this.logoMaxH = headerH * 1.05;
      this.barTop = H - footerH;
    } else {
      // ESCRITORIO (horizontal): rejilla grande y centrada, fondo a los lados, logo
      // montado sobre el borde superior, controles sobre el fondo abajo.
      const headerH = Math.max(80, H * 0.14);
      const footerH = Math.max(132, H * 0.17);
      const availH = H - headerH - footerH;
      const maxGridW = Math.min(W * 0.9, 1180);
      this.size = Math.floor(Math.min(maxGridW / this.cols, availH / this.rows, 220));
      this.gridW = this.size * this.cols;
      this.gridH = this.size * this.rows;
      this.gridX = (W - this.gridW) / 2;
      this.gridY = headerH + Math.max(0, (availH - this.gridH) / 2);
      this.panelPad = Math.round(this.size * 0.16);
      // PC: logo en la ESQUINA superior-izquierda de la rejilla, inclinado para
      // seguir la curva del borde (no centrado).
      this.logoMaxW = Math.min(this.gridW * 0.26, 280);
      this.logoMaxH = this.panelPad * 3;
      // Pegado a la ESQUINA superior-izquierda: el centro cae casi sobre la esquina
      // del borde (montado encima), inclinado siguiendo la curva. Se acota para que no
      // se salga por la izquierda en pantallas estrechas.
      this.logoX = Math.max(this.logoMaxW * 0.5 + 8, this.gridX + this.logoMaxW * 0.05);
      this.logoY = this.gridY - this.panelPad * 0.35;
      this.logoAngle = -16;
      this.barTop = H - footerH;
    }

    const footerH = this.H - this.barTop;
    this.buttonY = this.barTop + footerH * 0.5;
    // Franja superior donde va la GANANCIA en PC (el hueco que deja el logo al centro).
    this.topInfoY = Math.max(28, this.gridY - this.panelPad * 1.1);
    // Banner+GANASTE: en PC arriba (zona de GANANCIA); en móvil, PEGADO bajo la rejilla
    // (fila compacta, sin hueco). Ancho acotado para no desbordar.
    this.bannerY = this.portrait ? this.winRowY : this.topInfoY;
    this.winMaxW = this.portrait ? this.gridW * 0.82 : this.gridW * 0.5;
  }

  private drawBackground() {
    // Fondo en degradado (definido en el builder) por debajo de todo.
    if (this.runtime.theme?.background_type === "GRADIENT") {
      const cols = (this.runtime.theme?.background_gradient || "")
        .split(",").map((s) => s.trim()).filter(Boolean);
      if (cols.length) {
        const top = hexToNum(cols[0], 0x101827);
        const bot = hexToNum(cols[cols.length - 1], 0x05030f);
        const grad = this.add.graphics().setDepth(-11);
        grad.fillGradientStyle(top, top, bot, bot, 1, 1, 1, 1);
        grad.fillRect(0, 0, this.W, this.H);
      }
    }
    // Fondo en VIDEO: lo renderiza un <video> HTML detrás del canvas transparente
    // (ver SlotGameCanvas + config.ts). Aquí no se pinta fondo; solo la viñeta inferior.
    const isVideoBg =
      this.runtime.theme?.background_type === "VIDEO" && !!this.runtime.theme?.assets?.background_video;
    if (isVideoBg) {
      // nada que pintar: el vídeo se ve por debajo del canvas transparente.
    } else if (this.textures.exists(TEX.bg)) {
      const bg = this.add.image(this.W / 2, this.H / 2, TEX.bg).setDepth(-10);
      const t = bg.texture.getSourceImage();
      const cover = Math.max(this.W / t.width, this.H / t.height);
      // A plena luz: Sweet Bonanza es brillante y colorido, no oscurecido.
      bg.setScale(cover).setAlpha(1);
    }
    // Solo un degradado inferior SUAVE para que los controles se lean sobre el fondo.
    const g = this.add.graphics().setDepth(-8);
    g.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, 0, 0.45, 0.45);
    g.fillRect(0, this.H * 0.66, this.W, this.H * 0.34);
  }

  private drawPanel() {
    const pad = this.panelPad;
    const r = Math.round(this.size * 0.22);
    const px = this.gridX - pad;
    const py = this.gridY - pad;
    const pw = this.gridW + pad * 2;
    const ph = this.gridH + pad * 2;

    // Resplandor suave del color de acento (sin oscurecer, estilo caramelo).
    const glow = this.add.graphics().setDepth(-3);
    for (let i = 3; i >= 1; i--) {
      glow.fillStyle(this.accent, 0.05);
      glow.fillRoundedRect(px - i * 8, py - i * 8, pw + i * 16, ph + i * 16, r + i * 6);
    }

    // Panel CLARO translúcido (como Sweet Bonanza): deja ver el fondo por detrás.
    const panel = this.add.graphics().setDepth(-2);
    panel.fillStyle(0xffffff, 0.12).fillRoundedRect(px, py, pw, ph, r);
    panel.fillStyle(0xffffff, 0.06).fillRoundedRect(px + 5, py + 5, pw - 10, ph - 10, r - 3);
    // Separadores verticales muy tenues entre rodillos.
    panel.lineStyle(2, 0xffffff, 0.1);
    for (let c = 1; c < this.cols; c++) {
      const x = this.gridX + c * this.size;
      panel.lineBetween(x, this.gridY, x, this.gridY + this.gridH);
    }

    // Borde punteado tipo caramelo (alterna acento/blanco).
    this.strokeDashedRoundedRect(px, py, pw, ph, r);
  }

  // Traza un rectángulo redondeado con borde PUNTEADO estilo caramelo: dashes que
  // alternan el color de acento y blanco en los lados rectos y esquinas sólidas.
  private strokeDashedRoundedRect(x: number, y: number, w: number, h: number, r: number, depth = -1) {
    const g = this.add.graphics().setDepth(depth);
    const th = Math.max(4, Math.round(this.size * 0.05));
    const dash = Math.max(10, Math.round(this.size * 0.16));
    const gap = Math.round(dash * 0.7);

    // Esquinas: arcos sólidos en color de acento.
    g.lineStyle(th, this.accent, 1);
    const P = Math.PI;
    const corner = (cx: number, cy: number, a0: number, a1: number) => {
      g.beginPath();
      g.arc(cx, cy, r, a0, a1);
      g.strokePath();
    };
    corner(x + r, y + r, P, P * 1.5); // sup-izq
    corner(x + w - r, y + r, P * 1.5, P * 2); // sup-der
    corner(x + w - r, y + h - r, 0, P * 0.5); // inf-der
    corner(x + r, y + h - r, P * 0.5, P); // inf-izq

    // Lados rectos: dashes alternando acento/blanco.
    const edges: [number, number, number, number][] = [
      [x + r, y, x + w - r, y], // arriba
      [x + w, y + r, x + w, y + h - r], // derecha
      [x + w - r, y + h, x + r, y + h], // abajo
      [x, y + h - r, x, y + r], // izquierda
    ];
    let idx = 0;
    for (const [x1, y1, x2, y2] of edges) {
      const len = Math.hypot(x2 - x1, y2 - y1);
      const ux = (x2 - x1) / len;
      const uy = (y2 - y1) / len;
      let d = 0;
      while (d < len) {
        const seg = Math.min(dash, len - d);
        g.lineStyle(th, idx % 2 ? 0xffffff : this.accent, 1);
        g.lineBetween(x1 + ux * d, y1 + uy * d, x1 + ux * (d + seg), y1 + uy * (d + seg));
        d += dash + gap;
        idx++;
      }
    }
  }

  // Códigos REALES de los símbolos del casino, preferentemente los que YA tienen
  // textura cargada, para que el desenfoque del giro use las imágenes subidas y no
  // caiga a los iconos por defecto. Si ninguno tiene imagen, usa todos los códigos.
  private symbolPool(): string[] {
    const codes = (this.runtime.theme?.symbols ?? []).map((s) => s.code);
    if (codes.length === 0) return SYMBOLS as unknown as string[];
    const withArt = codes.filter((c) => this.textures.exists(`sym-${c}`));
    return withArt.length ? withArt : codes;
  }

  private buildReels() {
    this.reels = [];
    const pool = this.symbolPool();
    for (let c = 0; c < this.cols; c++) {
      this.reels.push(new Reel(this, this.gridX + c * this.size, this.gridY, c, this.rows, this.size, pool));
    }
  }

  private drawTitle() {
    // Logo: en PC va en la esquina superior-izquierda inclinado siguiendo el borde;
    // en móvil, grande y centrado arriba.
    if (this.textures.exists(TEX.logo)) {
      const logo = this.add.image(this.logoX, this.logoY, TEX.logo).setOrigin(0.5).setDepth(3);
      this.fitImage(logo, this.logoMaxW, this.logoMaxH);
      logo.setAngle(this.logoAngle);
      // Flotación suave (bonito, animado).
      this.tweens.add({
        targets: logo, y: this.logoY - 7, duration: 1700, yoyo: true, repeat: -1, ease: "Sine.easeInOut",
      });
    } else {
      this.add
        .text(this.logoX, this.logoY, this.runtime.theme?.title ?? "SLOT", {
          fontFamily: "Arial, sans-serif",
          fontSize: `${Math.round(Math.min(this.logoMaxW * 0.14, this.logoMaxH * 0.8))}px`,
          fontStyle: "bold",
          color: this.accentHex,
          stroke: "#000000",
          strokeThickness: 7,
          align: "center",
          wordWrap: { width: this.logoMaxW },
        })
        .setOrigin(0.5)
        .setAngle(this.logoAngle)
        .setShadow(0, 3, "#000000", 6, false, true)
        .setDepth(3);
    }
  }

  private drawBanner() {
    if (!this.textures.exists(TEX.prizeBanner)) return;
    // El banner de premio NO se pinta fijo (antes se atravesaba todo el slot): se crea
    // OCULTO y aparece solo al ganar, detrás del texto GANASTE y ajustado a su tamaño.
    this.prizeBannerImg = this.add
      .image(this.W / 2, this.bannerY, TEX.prizeBanner)
      .setDepth(5)
      .setVisible(false);
  }

  // -------------------------------------------------------------------- //
  // Barra de controles inferior (estilo Pragmatic/Playtech): SALDO ·      //
  // APUESTA (con −/+) · GANANCIA, y el botón de girar al centro.          //
  // -------------------------------------------------------------------- //
  private buildControls() {
    const barH = this.H - this.barTop;
    const P = this.portrait;
    const labelSize = Math.round(Math.min(this.W * (P ? 0.032 : 0.024), P ? 16 : 18));
    const valueSize = Math.round(Math.min(this.W * (P ? 0.05 : 0.04), P ? 30 : 34));

    const spinMax = P
      ? Math.min(barH * 0.4, this.W * 0.28, 150)
      : Math.min(barH * 0.86, 130, this.W * 0.15);
    const btnR = Math.min(spinMax * 0.32, P ? 30 : 26);
    const tR = Math.min(barH * (P ? 0.08 : 0.15), 22);

    // Posiciones según orientación (móvil = apilado; escritorio = giro a la derecha).
    let spinX: number, spinY: number, minusX: number, plusX: number;
    let creditX: number, creditY: number, betX: number, betY: number;
    let autoX: number, autoY: number, turboX: number, turboY: number;
    let musicX: number, musicY: number;

    if (P) {
      // MÓVIL: giro centrado con −/+; crédito/apuesta debajo; iconos en fila. Todo
      // SUBIDO dentro del footer para que no quede pegado al borde inferior.
      spinX = this.W / 2;
      spinY = this.barTop + barH * 0.1;
      minusX = spinX - spinMax / 2 - 18 - btnR;
      plusX = spinX + spinMax / 2 + 18 + btnR;
      creditX = this.W * 0.28; betX = this.W * 0.72;
      creditY = betY = this.barTop + barH * 0.4;
      const iconY = this.barTop + barH * 0.64;
      turboX = this.W * 0.32; autoX = this.W * 0.5; musicX = this.W * 0.68;
      turboY = autoY = musicY = iconY;
    } else {
      // ESCRITORIO: giro a la derecha con −/+; TURBO/AUTO AL LADO del − (no debajo,
      // así el AUTO no se sale de pantalla); crédito/apuesta a la izquierda.
      const rightMargin = Math.max(28, this.W * 0.03);
      plusX = this.W - rightMargin - btnR;
      spinX = plusX - btnR - 22 - spinMax / 2;
      spinY = this.buttonY;
      minusX = spinX - spinMax / 2 - 22 - btnR;
      autoX = Math.max(tR + 6, minusX - btnR - tR - 24);
      turboX = Math.max(tR + 6, autoX - tR * 2 - 18);
      autoY = turboY = spinY;
      creditX = Math.max(96, this.W * 0.1); creditY = this.barTop + barH * 0.34;
      betX = creditX; betY = this.barTop + barH * 0.72;
      musicX = Math.max(tR + 10, this.W * 0.03); musicY = spinY;
    }

    // CRÉDITO / APUESTA.
    this.balanceValue = this.makeStat(creditX, creditY, `CRÉDITO · ${this.currency}`, this.money(this.balance), labelSize, valueSize, "#ffffff");
    this.betValue = this.makeStat(betX, betY, "APUESTA", this.money(this.bet), labelSize, valueSize, this.accentHex);

    // Pista de turbo (solo escritorio: hay sitio) + GANANCIA (aparece al ganar).
    if (!P) {
      this.add
        .text(this.W / 2, this.barTop + barH * 0.3, "MANTÉN ESPACIO PARA TIRADA TURBO", {
          fontFamily: "Arial, sans-serif", fontSize: `${labelSize}px`, fontStyle: "bold",
          color: "#ffffff", stroke: "#000000", strokeThickness: 3,
        })
        .setOrigin(0.5).setShadow(0, 2, "#000000", 5, false, true).setDepth(7);
    }
    // GANANCIA: en PC arriba (franja del logo); en móvil, PEGADA bajo la rejilla. Va en
    // un contenedor para OCULTARLA mientras se muestra el banner de victoria.
    const winY = P ? this.winRowY : this.topInfoY;
    const gLabel = this.add
      .text(this.W / 2, winY - valueSize * 0.6, "GANANCIA", {
        fontFamily: "Arial, sans-serif", fontSize: `${labelSize}px`, fontStyle: "bold",
        color: "#ffffff", stroke: "#000000", strokeThickness: 3,
      })
      .setOrigin(0.5).setShadow(0, 2, "#000000", 5, false, true);
    this.winValue = this.add
      .text(this.W / 2, winY + labelSize * 0.7, this.money(0), {
        fontFamily: "Arial, sans-serif", fontSize: `${valueSize}px`, fontStyle: "bold",
        color: "#06d6a0", stroke: "#000000", strokeThickness: 5,
      })
      .setOrigin(0.5).setShadow(0, 2, "#000000", 6, false, true);
    this.winGroup = this.add.container(0, 0, [gLabel, this.winValue]).setDepth(7);

    // Botón de giro (imagen del tema, o círculo de acento con la flecha ⟳).
    const hasSpinImg = this.textures.exists(TEX.spinBtn);
    if (!hasSpinImg) {
      const circle = this.add.graphics().setDepth(7);
      circle.fillStyle(this.accent, 1).fillCircle(spinX, spinY, spinMax / 2);
      circle.lineStyle(4, 0xffffff, 0.55).strokeCircle(spinX, spinY, spinMax / 2);
    }
    this.button = this.add
      .image(spinX, spinY, hasSpinImg ? TEX.spinBtn : TEX.button)
      .setDepth(8)
      .setInteractive({ useHandCursor: true });
    if (hasSpinImg) this.fitImage(this.button, spinMax, spinMax);
    else this.button.setVisible(false);
    this.buttonLabel = this.add
      .text(spinX, spinY, hasSpinImg ? "" : "⟳", {
        fontFamily: "Arial, sans-serif",
        fontSize: `${Math.round(spinMax * 0.5)}px`,
        fontStyle: "bold",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setDepth(9);
    this.button.on("pointerdown", () => this.onSpin());
    const pulseTarget = hasSpinImg ? this.button : this.buttonLabel;
    this.pulse = this.tweens.add({
      targets: pulseTarget,
      scale: pulseTarget.scale * 1.06,
      duration: 750,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    // −/+ (cambian la apuesta).
    this.makeRoundButton(minusX, spinY, "−", btnR, () => this.changeBet(-1), TEX.betMinus);
    this.makeRoundButton(plusX, spinY, "+", btnR, () => this.changeBet(1), TEX.betPlus);

    // TURBO / AUTO.
    this.autoToggle = this.makeToggle(autoX, autoY, "∞", "AUTO", tR, () => this.toggleAuto(), TEX.autoOn, TEX.autoOff);
    this.turboToggle = this.makeToggle(turboX, turboY, "⚡", "TURBO", tR, () => this.toggleTurbo(), TEX.turboOn, TEX.turboOff);
    this.turboToggle.setActive(this.turbo);

    // Música.
    this.musicR = tR;
    this.musicX = musicX;
    this.musicY = musicY;
  }

  // Crea un bloque "ETIQUETA / valor" centrado en (x, y); devuelve el texto del valor.
  private makeStat(x: number, y: number, label: string, value: string, labelSize: number, valueSize: number, color: string) {
    this.add
      .text(x, y - valueSize * 0.6, label, {
        fontFamily: "Arial, sans-serif",
        fontSize: `${labelSize}px`,
        fontStyle: "bold",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setShadow(0, 2, "#000000", 5, false, true)
      .setDepth(7);
    return this.add
      .text(x, y + labelSize * 0.7, value, {
        fontFamily: "Arial, sans-serif",
        fontSize: `${valueSize}px`,
        fontStyle: "bold",
        color,
        stroke: "#000000",
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setShadow(0, 2, "#000000", 6, false, true)
      .setDepth(7);
  }

  private makeRoundButton(x: number, y: number, glyph: string, r: number, onClick: () => void, texKey?: string) {
    const hasImg = !!texKey && this.textures.exists(texKey);
    if (hasImg) {
      const img = this.add.image(x, y, texKey!).setDepth(9);
      this.fitImage(img, r * 2.3, r * 2.3);
    } else {
      const g = this.add.graphics().setDepth(8);
      g.fillStyle(0x1a2238, 0.95).fillCircle(x, y, r);
      g.lineStyle(2, this.accent, 0.7).strokeCircle(x, y, r);
      this.add
        .text(x, y - 2, glyph, {
          fontFamily: "Arial, sans-serif",
          fontSize: `${Math.round(r * 1.3)}px`,
          fontStyle: "bold",
          color: "#ffd23f",
        })
        .setOrigin(0.5)
        .setDepth(9);
    }
    this.add
      .zone(x, y, r * 2, r * 2)
      .setInteractive({ useHandCursor: true })
      .setDepth(10)
      .on("pointerdown", onClick);
  }

  // Botón redondo con estado. Usa imágenes on/off del tema si existen; si no,
  // dibuja el círculo con el color de acento. Devuelve un handle para setActive.
  private makeToggle(
    x: number, y: number, glyph: string, caption: string, r: number, onClick: () => void,
    onTex?: string, offTex?: string,
  ): Toggle {
    // Tolerante: basta con UNA de las dos imágenes (on/off). Si falta una, se usa la
    // disponible para ambos estados y se distingue activo/inactivo por opacidad.
    const onAvail = !!onTex && this.textures.exists(onTex);
    const offAvail = !!offTex && this.textures.exists(offTex);
    const hasImg = onAvail || offAvail;
    const texOn = onAvail ? onTex! : offTex!;
    const texOff = offAvail ? offTex! : onTex!;
    const sameTex = texOn === texOff; // solo se subió una imagen
    const g = hasImg ? undefined : this.add.graphics().setDepth(8);
    const img = hasImg ? this.add.image(x, y, texOff).setDepth(9) : undefined;
    if (img) this.fitImage(img, r * 2.3, r * 2.3);
    const glyphTxt = hasImg
      ? undefined
      : this.add
          .text(x, y - 1, glyph, {
            fontFamily: "Arial, sans-serif",
            fontSize: `${Math.round(r * 1.05)}px`,
            fontStyle: "bold",
            color: "#c9d3e6",
          })
          .setOrigin(0.5)
          .setDepth(9);
    this.add
      .text(x, y + r + 8, caption, {
        fontFamily: "Arial, sans-serif",
        fontSize: `${Math.max(9, Math.round(r * 0.42))}px`,
        fontStyle: "bold",
        color: "#7a869e",
      })
      .setOrigin(0.5)
      .setDepth(9);
    const draw = (on: boolean) => {
      if (img) {
        img.setTexture(on ? texOn : texOff);
        this.fitImage(img, r * 2.3, r * 2.3);
        // Con una sola imagen, el estado activo se distingue por opacidad.
        img.setAlpha(sameTex && !on ? 0.5 : 1);
      } else if (g && glyphTxt) {
        g.clear();
        g.fillStyle(on ? this.accent : 0x1a2238, on ? 1 : 0.95).fillCircle(x, y, r);
        g.lineStyle(2, on ? 0xfff2b0 : this.accent, on ? 1 : 0.55).strokeCircle(x, y, r);
        glyphTxt.setColor(on ? "#3a2a00" : "#c9d3e6");
      }
    };
    draw(false);
    this.add
      .zone(x, y, r * 2, r * 2)
      .setInteractive({ useHandCursor: true })
      .setDepth(10)
      .on("pointerdown", onClick);
    return { setActive: draw };
  }

  private toggleTurbo() {
    this.turbo = !this.turbo;
    this.registry.set("turbo", this.turbo);
    this.turboToggle?.setActive(this.turbo);
    sfx.reelStop();
  }

  private toggleAuto() {
    if (this.autoOn) {
      this.stopAuto(); // parar: apaga el estado Y cancela el giro ya programado
    } else {
      this.autoOn = true;
      this.autoToggle?.setActive(true);
      if (!this.busy) this.onSpin();
    }
    sfx.reelStop();
  }

  private changeBet(dir: number) {
    if (this.busy) return;
    const levels = this.betLevels.length ? this.betLevels : [this.bet];
    let idx = levels.findIndex((v) => v >= this.bet);
    if (idx < 0) idx = levels.length - 1;
    idx = Phaser.Math.Clamp(idx + dir, 0, levels.length - 1);
    this.bet = Phaser.Math.Clamp(levels[idx], this.betMin, this.betMax);
    this.registry.set("bet", this.bet);
    this.betValue.setText(this.money(this.bet));
    sfx.reelStop();
  }

  // -------------------------------------------------------------------- //
  // Música                                                                //
  // -------------------------------------------------------------------- //
  private setupMusic() {
    if (this.cache.audio.exists(TEX.musicTrack)) {
      this.music = this.sound.add(TEX.musicTrack, { loop: true, volume: 0.35 });
    }
    if (this.textures.exists(TEX.musicOn) && this.textures.exists(TEX.musicOff)) {
      const d = this.musicR * 2.1;
      this.musicBtn = this.add
        .image(this.musicX, this.musicY, this.musicMuted ? TEX.musicOff : TEX.musicOn)
        .setDepth(9)
        .setInteractive({ useHandCursor: true });
      this.fitImage(this.musicBtn, d, d);
      this.musicBtn.on("pointerdown", () => this.toggleMusic());
    }
  }

  private tryStartMusic() {
    if (this.music && !this.musicMuted && !this.music.isPlaying) this.music.play();
  }

  private toggleMusic() {
    this.musicMuted = !this.musicMuted;
    this.registry.set("musicMuted", this.musicMuted);
    if (this.musicMuted) this.music?.pause();
    else if (this.music) (this.music.isPaused ? this.music.resume() : this.music.play());
    this.musicBtn?.setTexture(this.musicMuted ? TEX.musicOff : TEX.musicOn);
    if (this.musicBtn) this.fitImage(this.musicBtn, this.musicR * 2.1, this.musicR * 2.1);
  }

  private fitImage(img: Phaser.GameObjects.Image, maxW: number, maxH: number) {
    const t = img.texture.getSourceImage();
    const scale = Math.min(maxW / t.width, maxH / t.height, 1);
    img.setScale(scale);
  }

  // -------------------------------------------------------------------- //
  private money(minor: number): string {
    const value = minor / 10 ** this.curExp;
    return `${this.curSymbol}${value.toLocaleString(undefined, {
      minimumFractionDigits: this.curExp,
      maximumFractionDigits: this.curExp,
    })}`;
  }

  private setButtonEnabled(enabled: boolean) {
    this.button.setAlpha(enabled ? 1 : 0.45);
    this.buttonLabel.setAlpha(enabled ? 1 : 0.45);
    if (enabled) this.button.setInteractive({ useHandCursor: true });
    else this.button.disableInteractive();
  }

  private clearTransient() {
    this.winGfx.clear();
    this.winText.setText("");
    this.prizeBannerImg?.setVisible(false);
    this.winGroup?.setVisible(true);
    this.transient.forEach((o) => o.destroy());
    this.transient = [];
  }

  private column(matrix: string[][], c: number): string[] {
    return matrix.map((row) => row[c]);
  }

  private randomColumn(): string[] {
    const pool = this.symbolPool();
    return Array.from({ length: this.rows }, () => Phaser.Utils.Array.GetRandom(pool));
  }

  private async onSpin() {
    if (this.busy) return;
    this.busy = true;
    this.clearTransient();
    this.setButtonEnabled(false);

    sfx.unlock();
    sfx.spin();
    this.tryStartMusic();
    this.pulse?.pause();
    this.winValue.setText(this.money(0));
    this.reels.forEach((r) => r.startSpin());

    try {
      const resp = await this.runtime.spin(this.bet);

      const validMatrix =
        Array.isArray(resp.matrix) &&
        resp.matrix.length === this.rows &&
        resp.matrix.every((row) => row.length === this.cols);

      const stagger = this.turbo ? 55 : 180;
      const dur = this.turbo ? 260 : 650;
      await Promise.all(
        this.reels.map((reel, c) => {
          const target = validMatrix ? this.column(resp.matrix, c) : this.randomColumn();
          return reel.stop(target, c * stagger, dur).then(() => sfx.reelStop());
        })
      );

      if (typeof resp.balance === "number") {
        this.balance = resp.balance;
        this.registry.set("balance", this.balance);
        this.balanceValue.setText(this.money(this.balance));
        this.runtime.onBalance?.(resp.balance);
      }
      if (validMatrix) this.present(resp);
      else this.flashMessage("Respuesta inesperada del servidor", "#ef476f");

      // Estado de tiradas gratis (viene del servidor). Debe leerse SIEMPRE, gane o no.
      this.updateFreeSpins(resp);
    } catch (err) {
      await Promise.all(this.reels.map((reel, c) => reel.stop(this.randomColumn(), c * 150)));
      // Si React maneja el error (p. ej. modal de saldo insuficiente), no mostramos el
      // mensaje rojo genérico dentro del canvas.
      const handled = this.runtime.onSpinError?.(err) === true;
      if (!handled) this.flashMessage(err instanceof Error ? err.message : "Error de red", "#ef476f");
      this.stopAuto(); // ante un error (p.ej. saldo insuficiente) se detiene el autoplay
    } finally {
      this.busy = false;
      this.setButtonEnabled(true);
      this.pulse?.resume();
      this.maybeAutoNext();
    }
  }

  // Procesa el estado de tiradas gratis de la respuesta: dispara el aviso, actualiza
  // el contador y activa/desactiva la ronda.
  private updateFreeSpins(resp: SpinResponse) {
    if ((resp.scatter_count ?? 0) > 0) this.highlightScatters(resp.matrix);
    const remaining = resp.free_spins_remaining ?? 0;
    const justTriggered = !!resp.free_spins_triggered && !resp.in_free_spins;
    this.freeSpinsRemaining = remaining;
    this.freeMultiplier = resp.win_multiplier && resp.win_multiplier > 1 ? resp.win_multiplier : 1;

    if (justTriggered) {
      // Un tiro PAGADO abrió la ronda: aviso grande.
      this.freeMultiplier = 1; // el multiplicador aplica en las tiradas libres siguientes
      this.announceFreeSpins(resp.free_spins_awarded ?? remaining);
    }
    this.renderFreeSpinsBadge();
  }

  // Marca con un pulso los símbolos SCATTER que hayan caído.
  private highlightScatters(matrix: string[][]) {
    const scatters = new Set(
      (this.runtime.theme?.symbols ?? []).filter((s) => s.is_scatter).map((s) => s.code)
    );
    if (!scatters.size) return;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (scatters.has(matrix[r]?.[c])) {
          const p = this.reels[c].cellCenter(r);
          const ring = this.add.graphics().setDepth(7);
          ring.lineStyle(6, 0xffffff, 0.95);
          ring.strokeCircle(p.x, p.y, this.size * 0.42);
          this.transient.push(ring);
          this.tweens.add({ targets: ring, alpha: 0.2, duration: 500, yoyo: true, repeat: 2 });
        }
      }
    }
  }

  // Aviso a pantalla de "¡X TIRADAS GRATIS!".
  private announceFreeSpins(awarded: number) {
    sfx.bigWin();
    const cx = this.W / 2;
    const cy = this.gridY + this.gridH / 2;
    const overlay = this.add.rectangle(0, 0, this.W, this.H, 0x000000, 0.55).setOrigin(0).setDepth(20);
    const cont = this.add.container(cx, cy).setDepth(30).setScale(0);
    const t1 = this.add.text(0, -30, `${awarded} TIRADAS GRATIS`, {
      fontFamily: "Arial, sans-serif", fontSize: `${Math.round(Math.min(this.W * 0.09, 64))}px`,
      fontStyle: "bold", color: this.accentHex, stroke: "#000000", strokeThickness: 8,
    }).setOrigin(0.5);
    const t2 = this.add.text(0, 40, "¡PREPÁRATE!", {
      fontFamily: "Arial, sans-serif", fontSize: `${Math.round(Math.min(this.W * 0.05, 34))}px`,
      fontStyle: "bold", color: "#ffffff", stroke: "#000000", strokeThickness: 5,
    }).setOrigin(0.5);
    cont.add([t1, t2]);
    this.transient.push(overlay, cont);
    this.tweens.add({ targets: cont, scale: 1, duration: 500, ease: "Back.easeOut" });
    this.time.delayedCall(1600, () => {
      this.tweens.add({ targets: [overlay, cont], alpha: 0, duration: 350, onComplete: () => { overlay.destroy(); cont.destroy(); } });
    });
  }

  // Insignia persistente con los tiros gratis restantes y el multiplicador.
  private renderFreeSpinsBadge() {
    if (this.freeSpinsRemaining <= 0) {
      this.fsBadge?.destroy();
      this.fsBadge = undefined;
      this.fsBadgeText = undefined;
      return;
    }
    const label = `🎁 GRATIS: ${this.freeSpinsRemaining}${this.freeMultiplier > 1 ? `  ×${this.freeMultiplier}` : ""}`;
    if (!this.fsBadge) {
      const y = this.gridY - this.panelPad - 6;
      const bg = this.add.graphics();
      this.fsBadgeText = this.add.text(0, 0, label, {
        fontFamily: "Arial, sans-serif", fontSize: `${Math.round(Math.min(this.W * 0.026, 20))}px`,
        fontStyle: "bold", color: "#ffffff", stroke: "#000000", strokeThickness: 4,
      }).setOrigin(0.5);
      const w = this.fsBadgeText.width + 28;
      const h = this.fsBadgeText.height + 12;
      bg.fillStyle(this.accent, 0.95).fillRoundedRect(-w / 2, -h / 2, w, h, 10);
      this.fsBadge = this.add.container(this.W - w / 2 - 20, y, [bg, this.fsBadgeText]).setDepth(12);
    } else {
      this.fsBadgeText!.setText(label);
    }
  }

  // Encadena el siguiente giro automático (autoplay) o la siguiente TIRADA GRATIS.
  private maybeAutoNext() {
    // Ronda de tiradas gratis: encadena sola hasta agotarse (no consume saldo).
    if (this.freeSpinsRemaining > 0) {
      this.time.delayedCall(this.turbo ? 260 : 900, () => {
        if (!this.busy) this.onSpin();
      });
      return;
    }
    if (!this.autoOn) return;
    if (this.balance < this.bet) {
      this.stopAuto();
      return;
    }
    this.autoTimer = this.time.delayedCall(this.turbo ? 140 : 520, () => {
      if (this.autoOn && !this.busy) this.onSpin();
    });
  }

  private stopAuto() {
    this.autoOn = false;
    this.autoToggle?.setActive(false);
    // Mata el giro automático que estuviera en cola: sin esto, "parar" apagaba el
    // estado pero el delayedCall ya programado seguía disparando otro giro.
    this.autoTimer?.remove(false);
    this.autoTimer = undefined;
  }

  // -------------------------------------------------------------------- //
  private present(resp: SpinResponse) {
    if (resp.total_win <= 0) return;
    this.winValue.setText(this.money(resp.total_win));
    const isBig = resp.jackpot_triggered || resp.total_win >= this.bet * BIG_WIN_MULTIPLIER;
    if (isBig) this.bigWin(resp);
    else this.normalWin(resp);
  }

  private normalWin(resp: SpinResponse) {
    sfx.win();
    this.winGroup.setVisible(false); // el banner ocupa la zona de GANANCIA

    this.winGfx.clear();
    for (const win of resp.winning_lines) {
      if (win.kind === "LINE" && win.line_index != null) {
        this.drawLineWin(win.line_index);
      } else if (win.kind === "WAY") {
        this.drawWayWin(resp.matrix, win.symbol, win.count);
      }
    }

    this.winText.setText(`GANASTE  ${this.money(resp.total_win)}`);
    // Escala para que NO se desborde de la rejilla: si el texto es más ancho que
    // winMaxW, se reduce; el rebote de entrada parte de esa escala ya ajustada.
    this.winText.setScale(1);
    const baseW = this.winText.width;
    const baseH = this.winText.height;
    const fit = Math.min(1, this.winMaxW / Math.max(1, baseW));

    // El banner de premio (si se subió) aparece detrás del texto, dimensionado a él.
    if (this.prizeBannerImg) {
      this.prizeBannerImg.setPosition(this.W / 2, this.bannerY).setVisible(true).setScale(1);
      this.fitImage(this.prizeBannerImg, baseW * fit * 1.5 + 40, baseH * fit * 2.6);
    }

    this.winText.setScale(fit * 0.6);
    this.tweens.add({ targets: this.winText, scale: fit, duration: 350, ease: "Back.easeOut" });
  }

  // Resalta una línea de pago (modo LINES): traza la línea y enmarca cada celda.
  private drawLineWin(lineIndex: number) {
    const pattern = this.paylines[lineIndex];
    if (!pattern) return;
    const points = pattern.map((row, c) => this.reels[c].cellCenter(row));
    this.winGfx.lineStyle(8, this.accent, 0.95);
    for (let i = 0; i < points.length - 1; i++) {
      this.winGfx.lineBetween(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);
    }
    points.forEach((p) => this.frameCell(p.x, p.y));
  }

  // Resalta una victoria WAYS: enmarca todas las celdas del símbolo (o WILD) en
  // los primeros `count` carretes desde la izquierda (así el jugador ve qué ganó).
  private drawWayWin(matrix: string[][], symbol: string, count: number) {
    const wilds = new Set(
      (this.runtime.theme?.symbols ?? []).filter((s) => s.is_wild).map((s) => s.code)
    );
    wilds.add("WILD");
    for (let c = 0; c < Math.min(count, this.cols); c++) {
      for (let r = 0; r < this.rows; r++) {
        const s = matrix[r]?.[c];
        if (s === symbol || wilds.has(s)) {
          const p = this.reels[c].cellCenter(r);
          this.frameCell(p.x, p.y);
        }
      }
    }
  }

  private frameCell(x: number, y: number) {
    this.winGfx.lineStyle(6, this.accent, 0.95);
    this.winGfx.strokeRoundedRect(
      x - this.size / 2 + 6,
      y - this.size / 2 + 6,
      this.size - 12,
      this.size - 12,
      16
    );
  }

  private bigWin(resp: SpinResponse) {
    sfx.bigWin();
    this.winGroup.setVisible(false);

    const cx = this.W / 2;
    const cy = this.gridY + this.gridH / 2;

    const overlay = this.add
      .rectangle(0, 0, this.W, this.H, 0x000000, 0.6)
      .setOrigin(0)
      .setDepth(20);
    this.transient.push(overlay);

    const coins = this.add
      .particles(0, 0, TEX.coin, {
        lifespan: 1600,
        speed: { min: 250, max: 560 },
        angle: { min: 240, max: 300 },
        gravityY: 900,
        scale: { start: 0.9, end: 0.2 },
        rotate: { min: 0, max: 360 },
        tint: [this.accent, 0xffe066, 0xffb703],
        emitting: false,
      })
      .setDepth(25);
    coins.explode(70, cx, cy - 40);
    this.transient.push(coins);

    const confetti = this.add
      .particles(0, 0, TEX.confetti, {
        lifespan: 2200,
        speed: { min: 150, max: 420 },
        angle: { min: 200, max: 340 },
        gravityY: 500,
        scale: { start: 1, end: 0.4 },
        rotate: { min: 0, max: 360 },
        tint: [0xef476f, 0x06d6a0, 0x00bbf9, 0x9b5de5, 0xffd23f],
        emitting: false,
      })
      .setDepth(25);
    confetti.explode(90, cx, cy - 60);
    this.transient.push(confetti);

    const title = resp.jackpot_triggered ? "¡JACKPOT!" : "¡BIG WIN!";
    const banner = this.add.container(cx, cy).setDepth(30);
    const titleText = this.add
      .text(0, -50, title, {
        fontFamily: "Arial, sans-serif",
        fontSize: `${Math.round(Math.min(this.W * 0.16, 90))}px`,
        fontStyle: "bold",
        color: this.accentHex,
        stroke: "#000000",
        strokeThickness: 8,
      })
      .setOrigin(0.5);
    const amountText = this.add
      .text(0, 40, this.money(resp.total_win), {
        fontFamily: "Arial, sans-serif",
        fontSize: `${Math.round(Math.min(this.W * 0.12, 68))}px`,
        fontStyle: "bold",
        color: "#ffffff",
      })
      .setOrigin(0.5);
    banner.add([titleText, amountText]);
    banner.setScale(0);
    this.transient.push(banner);

    this.tweens.add({ targets: banner, scale: 1, duration: 550, ease: "Back.easeOut" });
    this.tweens.add({ targets: titleText, angle: { from: -4, to: 4 }, duration: 500, yoyo: true, repeat: -1 });

    this.time.delayedCall(2800, () => {
      this.tweens.add({
        targets: [overlay, banner],
        alpha: 0,
        duration: 400,
        onComplete: () => this.clearTransient(),
      });
    });
  }

  private flashMessage(text: string, color: string) {
    const msg = this.add
      .text(this.W / 2, this.bannerY, text, {
        fontFamily: "Arial, sans-serif",
        fontSize: "30px",
        color,
        align: "center",
        wordWrap: { width: this.W - 60 },
      })
      .setOrigin(0.5)
      .setDepth(9);
    this.transient.push(msg);
    this.time.delayedCall(2500, () => msg.destroy());
  }
}
