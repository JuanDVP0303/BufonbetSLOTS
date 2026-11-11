import Phaser from "phaser";
import { SYMBOLS, PAYLINES, WIN_TIERS, TEX } from "../constants";
import type { WinTier } from "../constants";
import { Reel } from "../Reel";
import { sfx } from "../sfx";
import type { SpinResponse } from "../../api/spinApi";
import type { RuntimeConfig } from "../config";
import type { MascotFrames } from "../gifMascot";
import { CONFIG_MOBILE, MOBILE_FONT, designScaleFactor } from "../mobile/configMobile";
import { CONFIG_DESKTOP, DESKTOP_FONT } from "../desktop/configDesktop";
import {
  chooseLayoutMode,
  computeDesktopLayout,
  desktopDesignSize,
  desktopRenderScale,
  portraitDesignSize,
  type DesktopLayout,
  type LayoutMode,
} from "../desktop/layoutDesktop";
import { DesktopHud, removeTweensOf, type TextLike } from "../desktop/DesktopHud";
import { bakeSymbolTexture, ensureDigitFont, ensureRaysTexture, ensureVignetteTexture } from "../desktop/assetsDesktop";

/** Botón redondo con estado activo/inactivo (turbo, autoplay). */
interface Toggle {
  setActive(on: boolean): void;
}

// MOBILE_FONT vive en mobile/configMobile.ts (compartida con PreloadScene,
// Fase 6).

/** Convierte "#ffd23f" (o "#fc0") a 0xffd23f; devuelve fallback si no es válido. */
function hexToNum(hex: string | undefined, fallback: number): number {
  if (!hex) return fallback;
  let m = hex.replace("#", "");
  if (m.length === 3) m = m.split("").map((c) => c + c).join("");
  const n = parseInt(m, 16);
  return Number.isNaN(n) ? fallback : n;
}

/**
 * Escena principal del slot. Dos diseños, elegidos por computeLayout(width, height):
 *  - "portrait": el diseño móvil (CONFIG_MOBILE), intacto.
 *  - "landscape": escritorio/horizontal (CONFIG_DESKTOP + desktop/layoutDesktop.ts).
 * En horizontal, el resize (con debounce) solo reposiciona: no recrea la escena.
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
  private size = 150; // ancho de celda/columna
  private cellH = 150; // SOLO MÓVIL (Corrección 4): alto de celda si es distinto del ancho (celdas 4:5)
  private gridX = 45;
  private gridY = 170;
  private gridW = 450;
  private gridH = 450;
  private panelPad = 20; // margen entre la rejilla y el borde de caramelo
  private portrait = false; // alto de diseño > ancho de diseño
  // true = diseño VERTICAL/móvil (CONFIG_MOBILE). Lo decide el modo de layout
  // (ver computeLayout): siempre en táctil, y en ventanas verticales de PC.
  private isMobile = false;
  // ---- Sistema de layout por orientación (ver computeLayout) ----------------
  private layoutMode: LayoutMode = "portrait";
  private isTouchDevice = false; // clase de DISPOSITIVO (no cambia en la sesión)
  private L?: DesktopLayout; // geometría horizontal vigente
  private renderScale = 1; // resolución interna / diseño (zoom de cámara), solo horizontal
  private hud?: DesktopHud;
  private reelsRoot?: Phaser.GameObjects.Container;
  private reelsMask?: Phaser.GameObjects.Graphics;
  private gridFrameImg?: Phaser.GameObjects.Image;
  private framePanel?: Phaser.GameObjects.Graphics;
  private logoCont?: Phaser.GameObjects.Container;
  private logoImg?: Phaser.GameObjects.Image | Phaser.GameObjects.Text;
  private logoSheen?: Phaser.GameObjects.Image;
  private charImgs: { left?: Phaser.GameObjects.Image; right?: Phaser.GameObjects.Image } = {};
  private resizeTimer?: number;
  private pendingRelayout = false;
  private coinFx?: Phaser.GameObjects.Particles.ParticleEmitter;
  private confettiFx?: Phaser.GameObjects.Particles.ParticleEmitter;
  private musicPausedByHide = false;
  private fsBadgeW = 0;
  // Fondo dentro del canvas (solo escritorio, canvas opaco): ver buildCanvasBackground.
  private bgGradient?: Phaser.GameObjects.Graphics;
  private bgImg?: Phaser.GameObjects.Image;
  private bgShade?: Phaser.GameObjects.Image;
  private logoY = 70;
  private logoX = 270; // posición horizontal del logo (centro en móvil, esquina en PC)
  private logoAngle = 0; // inclinación del logo (para seguir el borde en la esquina)
  private logoMaxW = 360; // tamaño máximo del logo (según orientación)
  private logoMaxH = 120;
  private topInfoY = 60; // franja superior (GANANCIA en PC, donde antes iba el logo)
  private winRowY = 60; // fila de GANANCIA/GANASTE (móvil: pegada bajo la rejilla)
  // REORGANIZACIÓN móvil (pedido, captura "Sugar Land"): el texto/banner de
  // celebración ("¡GANASTE $X!") sigue apareciendo pegado al marco, prominente
  // — independiente de dónde vive ahora la pastilla de GANANCIA en reposo
  // (`winRowY`, que pasó a apuntar a la fila de estadísticas del fondo). Solo
  // lo usa computeLayoutMobile()/computeLayout() (bannerY); en los demás
  // modos queda sin usar.
  private celebrationY = 300;
  private winMaxW = 400; // ancho máximo del texto "GANASTE" (para que no se desborde)
  private prizeBannerImg?: Phaser.GameObjects.Image; // banner de premio (solo visible al ganar)
  private bannerY = 700;
  private barTop = 800;
  private footerH = 160; // alto real del footer (puede diferir de `H - barTop` si hay margen debajo)

  private winGfx!: Phaser.GameObjects.Graphics;
  private winText?: Phaser.GameObjects.Text; // solo diseño móvil (horizontal usa el banner del HUD)
  private button!: Phaser.GameObjects.Image;
  private buttonLabel!: Phaser.GameObjects.Text;
  private pulse?: Phaser.Tweens.Tween;
  private spinIdlePulse?: Phaser.Tweens.Tween; // CORRECCIÓN 4 (punto 5): pulso lento del anillo/disco del SPIN
  private transient: Phaser.GameObjects.GameObject[] = [];
  // Pulsos de celdas ganadoras en curso (glow+escala) y el ciclo de líneas de pago
  // (se resaltan una por una cuando hay varias). Se apagan al limpiar el estado.
  private winPulseStops: Array<() => void> = [];
  private winCycleTimer?: Phaser.Time.TimerEvent;
  // Ganancia acumulada durante la RONDA de tiradas gratis (para el resumen final).
  private freeSpinsTotalWin = 0;
  // Reinicia una animación sutil sobre un carrete al azar tras unos segundos quietos.
  private idleTimer?: Phaser.Time.TimerEvent;

  // Estado económico (mostrado en la barra inferior, dentro del juego).
  private bet = 100;
  private betLevels: number[] = [];
  private betMin = 1;
  private betMax = 1_000_000;
  private balance = 0;
  private curSymbol = "$";
  private curExp = 2;
  private accent = 0xffd23f; // color predominante del tema (numérico, para gráficos)
  private accentHex = "#ffd23f"; // mismo color en texto (para estilos de Text)
  // Montos: Phaser.Text en móvil; BitmapText (vía adaptador) en horizontal.
  private balanceValue!: TextLike;
  private betValue!: TextLike;
  // REORGANIZACIÓN móvil: la APUESTA ahora se muestra DOS veces (pastilla
  // interactiva con −/+ + eco de solo lectura en la fila de estadísticas del
  // fondo, como en la referencia) — `betValueEcho` es ese segundo texto,
  // actualizado junto con `betValue` en changeBet(). `undefined` en
  // cualquier otro modo (nunca se asigna ahí), así que el `?.` es inerte.
  private betValueEcho?: Phaser.GameObjects.Text;
  private winValue!: TextLike;
  private winGroup!: Phaser.GameObjects.Container; // GANANCIA (se oculta al mostrar el banner)
  private legalText?: Phaser.GameObjects.Text; // SOLO MÓVIL: línea diminuta con el ID de la última ronda
  // SOLO MÓVIL (Corrección 4, punto 0): pastillas de CRÉDITO/APUESTA (antes
  // "línea de texto"), para poder pulsarlas desde onSpin()/changeBet().
  private creditPill?: { pulse: () => void };
  private betPill?: { pulse: () => void };
  // CORRECCIÓN 1: bounding boxes del HUD móvil para el modo debug (ver
  // CONFIG_MOBILE.debug.enabled, debugRegisterBox, debugCheckOverlaps).
  private debugBoxes: { name: string; x: number; y: number; w: number; h: number }[] = [];
  // SOLO MÓVIL: disco del botón de girar (para atenuarlo al deshabilitar) — Graphics
  // genérico, o la imagen de spin_button cuando el tema la subió (ver buildControlsMobile).
  private spinChip?: Phaser.GameObjects.Graphics | Phaser.GameObjects.Image;
  private spinningIndicatorTween?: Phaser.Tweens.Tween; // SOLO MÓVIL: giro continuo del icono mientras está deshabilitado (girando)

  // Turbo (frenado rápido) y autoplay (giros automáticos).
  private turbo = false;
  private autoOn = false;
  // FASE 4 DESKTOP (punto 2): "mantener ESPACIO activa turbo" — si la tecla
  // sigue abajo más de `spaceHoldMs`, se fuerza turbo=true hasta soltarla;
  // `turboForcedByHold` distingue eso de un turbo que el jugador ya había
  // activado a mano con el botón (para no desactivárselo al soltar la tecla).
  private spaceHoldTimer?: Phaser.Time.TimerEvent;
  private turboForcedByHold = false;
  // FASE 4 DESKTOP (punto 5): "saltar con espacio" en el overlay de BIG WIN
  // significa que SPACE hace DOS cosas a la vez con un solo listener cada
  // una (girar, y cerrar la celebración) — sin este freno, al tocar espacio
  // durante la celebración, onSpin() se dispara PRIMERO (se registró antes),
  // llama a clearTransient() y destruye el overlay/banner/rayos ANTES de que
  // el propio finish() de la celebración llegue a correr sobre ellos. Solo
  // lo usa celebrateBigWinDesktop(); en móvil queda siempre en `false`, así
  // que el chequeo en onSpin() es un no-op ahí (no cambia su comportamiento).
  private winOverlayActive = false;
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
  // Durante las tiradas gratis, el jugador puede PAUSAR el encadenado automático con
  // el botón AUTO para tirarlas a mano. true = pausado (no encadena la siguiente).
  private freePaused = false;

  // Mascota del premio grande (GIF decodificado a cuadros, o imagen estática): se
  // dibuja DENTRO del canvas con profundidad entre los rieles y el oscurecido.
  private mascotFrames?: MascotFrames;
  private mascotStaticKey?: string;
  private mascotImg?: Phaser.GameObjects.Image;
  private mascotFrameTimer?: Phaser.Time.TimerEvent;
  private mascotFrameIdx = 0;


  // Música de fondo del casino (opcional) y su botón de encendido/apagado.
  private music?: Phaser.Sound.BaseSound;
  private musicToggleMobile?: Toggle; // SOLO MÓVIL: ícono de SONIDO dibujado por código (ver CORRECCIÓN 1)
  private musicToggleDesktop?: Toggle; // horizontal: botón SONIDO de la barra
  private musicMuted = false;

  constructor() {
    super("Slot");
  }

  create() {
    this.runtime = this.registry.get("runtime") as RuntimeConfig;
    // Modo de layout: config.ts lo deja en el registry al arrancar y
    // switchLayoutMode() lo actualiza si una ventana de PC cruza vertical/horizontal.
    const regMobile = (this.registry.get("isMobile") as boolean) ?? false;
    this.isTouchDevice = (this.registry.get("isTouchDevice") as boolean | undefined) ?? regMobile;
    this.layoutMode = (this.registry.get("layoutMode") as LayoutMode | undefined) ?? (regMobile ? "portrait" : "landscape");
    this.isMobile = this.layoutMode === "portrait";
    // Phaser REUTILIZA la instancia en scene.restart(): referencias del modo
    // horizontal a objetos ya destruidos se limpian acá.
    this.L = undefined;
    this.hud = undefined;
    this.reelsRoot = undefined;
    this.reelsMask = undefined;
    this.gridFrameImg = undefined;
    this.framePanel = undefined;
    this.logoCont = undefined;
    this.logoImg = undefined;
    this.logoSheen = undefined;
    this.charImgs = {};
    this.bgGradient = undefined;
    this.bgImg = undefined;
    this.bgShade = undefined;
    this.coinFx = undefined;
    this.confettiFx = undefined;
    this.pendingRelayout = false;
    this.fsBadge = undefined;
    this.fsBadgeText = undefined;
    this.transient = [];
    this.winPulseStops = [];
    this.winOverlayActive = false;
    this.winText = undefined;
    this.prizeBannerImg = undefined;
    this.turboToggle = undefined;
    this.autoToggle = undefined;
    this.musicToggleMobile = undefined;
    this.musicToggleDesktop = undefined;
    this.creditPill = undefined;
    this.betPill = undefined;
    this.betValueEcho = undefined;
    this.legalText = undefined;
    this.spinChip = undefined;
    this.spinningIndicatorTween = undefined;
    this.pulse = undefined;
    this.spinIdlePulse = undefined;
    this.cols = this.runtime.grid?.cols ?? 3;
    this.rows = this.runtime.grid?.rows ?? 3;
    this.paylines = this.runtime.theme?.paylines?.length ? this.runtime.theme.paylines : PAYLINES;
    // Fase 6 móvil (regla 5) + FASE 4 DESKTOP (punto 6): la preferencia de
    // sonido se recuerda en localStorage (sobrevive a recargar la página), no
    // solo en el registry de Phaser (que es en memoria y se pierde al
    // refrescar) — en CUALQUIER modo (antes solo móvil; AUDITORÍA DESKTOP
    // punto 1: una versión anterior de este cambio puso `!this.isMobile`,
    // que por error le QUITABA esto a móvil en vez de sumárselo a
    // escritorio — corregido: sin condición de modo, aplica a todos).
    if (this.registry.get("musicMuted") === undefined) {
      try {
        const saved = localStorage.getItem(SlotScene.MUSIC_PREF_KEY);
        if (saved !== null) this.registry.set("musicMuted", saved === "1");
      } catch {
        /* localStorage bloqueado (modo privado, etc.): se ignora, no es crítico */
      }
    }
    this.musicMuted = (this.registry.get("musicMuted") as boolean) ?? false;

    // Apuesta/saldo persisten entre reinicios (resize) vía registry.
    this.betLevels = this.runtime.betLevels ?? [];
    this.betMin = this.runtime.betMin ?? 1;
    this.betMax = this.runtime.betMax ?? 1_000_000;
    this.bet = (this.registry.get("bet") as number) ?? this.runtime.betAmount;
    this.balance = (this.registry.get("balance") as number) ?? this.runtime.balance ?? 0;
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
    this.freePaused = false;
    this.autoTimer?.remove(false);
    this.autoTimer = undefined;
    // El GameObject de la mascota se destruyó con el resto de la escena anterior
    // (restart limpia la display list): no reusar la referencia.
    this.mascotImg = undefined;
    this.mascotFrameTimer?.remove(false);
    this.mascotFrameTimer = undefined;
    if (this.textures.exists(TEX.jackpotMascot)) this.mascotStaticKey = TEX.jackpotMascot;
    const mascotPromise = this.registry.get("mascotFramesPromise") as
      | Promise<MascotFrames | null>
      | undefined;
    mascotPromise?.then((frames) => {
      if (frames) this.mascotFrames = frames;
    });

    if (this.isMobile) {
      // ===== VERTICAL / MÓVIL: exactamente la misma secuencia de siempre. =====
      this.computeLayout(this.scale.width, this.scale.height);
      // Ventana VERTICAL de PC: el canvas es opaco → el fondo va dentro (en táctil
      // no: ahí lo pinta la capa DOM, como siempre).
      if (!this.isTouchDevice) {
        this.buildCanvasBackground(0.55);
        this.layoutCanvasBackground();
      }
      this.drawBackground();
      this.drawPanel();
      this.buildReels();

      this.winGfx = this.add.graphics().setDepth(5);
      this.drawTitle();
      this.drawBanner();

      // CORRECCIÓN 3 (punto 5, SOLO MÓVIL): el roll-up "GANASTE $x" en la
      // tipografía cartoon del resto del HUD móvil.
      this.winText = this.add
        .text(this.W / 2, this.bannerY, "", {
          fontFamily: MOBILE_FONT,
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

      this.buildControlsMobile();
    } else {
      // ===== HORIZONTAL / ESCRITORIO =====
      this.createDesktop();
    }
    this.setupMusic();
    this.resetIdleTimer();

    this.input.keyboard?.on("keydown-SPACE", () => {
      this.hud?.pressSpin();
      this.onSpin();
    });

    // Atajos de teclado (solo dispositivos con teclado, en ambos diseños):
    // mantener ESPACIO = tirada turbo, ← → cambian la apuesta, M silencia, F
    // pantalla completa (F11 es nativo del navegador; igual dispara un resize).
    if (!this.isTouchDevice) {
      this.input.keyboard?.on("keydown-SPACE", (e: KeyboardEvent) => {
        if (e.repeat) return; // el auto-repeat del navegador no debe reiniciar el temporizador de hold
        this.spaceHoldTimer?.remove(false);
        this.spaceHoldTimer = this.time.delayedCall(350, () => {
          if (!this.turbo) {
            this.turboForcedByHold = true;
            this.turbo = true;
            this.turboToggle?.setActive(true);
          }
        });
      });
      this.input.keyboard?.on("keyup-SPACE", () => {
        this.spaceHoldTimer?.remove(false);
        if (this.turboForcedByHold) {
          this.turboForcedByHold = false;
          this.turbo = false;
          this.turboToggle?.setActive(false);
        }
      });
      this.input.keyboard?.on("keydown-LEFT", () => this.changeBet(-1));
      this.input.keyboard?.on("keydown-RIGHT", () => this.changeBet(1));
      this.input.keyboard?.on("keydown-M", () => this.toggleMusic());
      if (CONFIG_DESKTOP.fullscreen.enabled) {
        this.input.keyboard?.on(`keydown-${CONFIG_DESKTOP.fullscreen.keyCode}`, () => this.scale.toggleFullscreen());
      }
      // Pestaña oculta: Phaser ya pausa su loop; además música y AudioContext.
      this.game.events.on(Phaser.Core.Events.HIDDEN, this.onHidden, this);
      this.game.events.on(Phaser.Core.Events.VISIBLE, this.onVisible, this);
    }

    // Recalcular al redimensionar la ventana (solo si no está girando).
    this.scale.on("resize", this.onResize, this);
    this.events.once("shutdown", () => {
      this.scale.off("resize", this.onResize, this);
      this.game.events.off(Phaser.Core.Events.HIDDEN, this.onHidden, this);
      this.game.events.off(Phaser.Core.Events.VISIBLE, this.onVisible, this);
      window.clearTimeout(this.resizeTimer);
      this.music?.stop();
      this.idleTimer?.remove(false);
      this.winCycleTimer?.remove(false);
      this.mascotFrameTimer?.remove(false);
      this.autoTimer?.remove(false);
      this.spaceHoldTimer?.remove(false);
    });
  }


  update(_time: number, dtMs: number) {
    // render() no hace nada si el carrete no se movió (ver Reel.render).
    for (const reel of this.reels) {
      reel.update(dtMs);
      reel.render();
    }
  }

  // -------------------------------------------------------------------- //
  // Reposo (idle): tras unos segundos sin girar, un pequeño pulso en un
  // carrete al azar para que el juego se sienta "vivo" (estilo Novomatic).
  // -------------------------------------------------------------------- //
  private resetIdleTimer() {
    this.idleTimer?.remove(false);
    this.idleTimer = this.time.delayedCall(7000, () => this.playIdle());
  }

  private playIdle() {
    if (this.busy) return;
    Phaser.Utils.Array.GetRandom(this.reels)?.idlePulse();
    this.resetIdleTimer();
  }

  // Radio de los iconos chicos (SONIDO/INFO/etc.) en móvil — SIEMPRE ≥44px
  // REALES de diámetro (mínimo táctil). Factorizado aparte (antes vivía
  // inline en buildControlsMobile) porque REORGANIZACIÓN móvil necesita el
  // MISMO número en computeLayoutMobile (para reservarle sitio a SONIDO/INFO
  // junto al logo, ver `logoMaxW` más abajo) — si cada lado calculara esto
  // por separado y alguna vez se desincroniza, el margen reservado podría
  // quedar más chico que el icono real, el mismo bug de "se sale del ancho"
  // que apareció al verificar con el script.
  private mobileIconR(): number {
    const minTapR = (44 * designScaleFactor()) / 2;
    return Math.max((this.W * CONFIG_MOBILE.layout.iconDiameterPct) / 2, minTapR);
  }

  // -------------------------------------------------------------------- //
  // Layout MÓVIL (Fase 1) — módulo aislado: solo se llama cuando           //
  // this.isMobile es true (pantalla táctil real). Desktop y la ventana    //
  // angosta no táctil (fallback) NO pasan por aquí.                       //
  // -------------------------------------------------------------------- //
  // Calcula toda la geometría móvil a partir de CONFIG_MOBILE, contra la
  // resolución de diseño FIJA (this.W/this.H ya son 1080x1920 en este modo,
  // porque Phaser usa Scale.FIT — ver game/config.ts). Deja los mismos campos
  // que consume el resto de la clase (gridX/Y/W/H, panelPad, winPanelH,
  // winRowY, logoX/Y/MaxW/MaxH, barTop, footerH), así TODO el dibujado
  // existente (buildReels, drawPanel, drawWinPanel, buildControls, etc.)
  // sigue funcionando sin cambios — Fase 1 es solo estructura, no arte.
  private computeLayoutMobile() {
    const W = this.W;
    const H = this.H;
    const Z = CONFIG_MOBILE.zones;

    // Márgenes de seguridad (notch / home indicator): configurados en px CSS
    // reales y convertidos a px de la resolución de diseño según cuánto esté
    // escalando Phaser en ESTE dispositivo concreto.
    const scale = designScaleFactor();
    const safeTop = CONFIG_MOBILE.safeArea.topPx * scale;
    const safeBottom = CONFIG_MOBILE.safeArea.bottomPx * scale;

    // Zona del logo/título: el margen de seguridad superior + su propia franja,
    // con un respiro (padding) explícito ARRIBA y ABAJO del logo — pedido
    // explícito: logo más grande (franja +30%) y más separado de la rejilla
    // (padding inferior más grande que el superior).
    const logoZoneH = H * Z.logoPct * 1.3;
    const logoPadTop = Math.round(18 * scale);
    const logoPadBottom = Math.round(34 * scale);
    const headerH = safeTop + logoPadTop + logoZoneH + logoPadBottom;

    // Margen lateral del marco — chico y FIJO en px REALES de pantalla (no
    // proporcional a la celda), reservado ANTES de medir el ancho de la
    // rejilla (calcularlo después podía dejarle a la rejilla más ancho del
    // que en realidad había disponible y el marco terminaba dibujándose con
    // coordenadas NEGATIVAS). Pedido explícito: la rejilla debe usar TODO el
    // ancho disponible — este margen es solo el mínimo para que el borde del
    // marco (dorado genérico, o los bordes del grid_frame del tema) no quede
    // pegado al borde físico del dispositivo.
    this.panelPad = Math.round(6 * scale);

    // CORRECCIÓN 4 (punto 3): celdas VERTICALES (4:5 ancho:alto) — el ANCHO
    // manda (pocas columnas), y el alto de celda se deriva de él. Ya NO hay
    // una "franja" de alto pre-reservada (antes Z.gridPct): la rejilla usa
    // TODO el alto que necesite, y el resto de las zonas (footer) se adapta
    // alrededor — así "aprovecha el alto" en vez de quedar atada a un % fijo.
    // El ancho disponible YA descuenta el margen del marco por ambos lados,
    // así que `gridX` (lo que sobra al centrar) nunca queda por debajo de
    // `panelPad` — el marco jamás se corta.
    const maxGridW = W - this.panelPad * 2;
    this.size = Math.floor(Math.min(maxGridW / this.cols, 500));
    this.cellH = Math.round(this.size * CONFIG_MOBILE.grid.cellAspectHW);
    this.gridW = this.size * this.cols;
    this.gridH = this.cellH * this.rows;
    this.gridX = (W - this.gridW) / 2;
    this.gridY = headerH; // pegada bajo el header, sin hueco

    // REORGANIZACIÓN (pedido explícito, captura de referencia "Sugar Land"):
    // GANANCIA ya NO va pegada al marco — se mudó a la fila de estadísticas
    // del fondo del footer, junto a CRÉDITO (ver buildControlsMobile()). El
    // hueco bajo el marco ahora es solo `panelGap`: aire VISIBLE de fondo
    // antes de que arranque el panel morado del HUD — "que lo demás se
    // comprima un poco" = el footer pierde esos mismos px de alto disponible
    // (protegido igual por el piso `H*0.16` de más abajo).
    const frameBottom = this.gridY + this.gridH + this.panelPad;
    const panelGap = Math.round(28 * scale);
    this.barTop = frameBottom + panelGap;
    this.footerH = Math.max(H * 0.16, H - this.barTop - safeBottom);

    // El texto/banner de "¡GANASTE $X!" durante una celebración sigue
    // apareciendo prominente, pegado al marco (como siempre) — INDEPENDIENTE
    // de dónde vive ahora la pastilla de GANANCIA en reposo (ver `winRowY`
    // más abajo, que de acá en más apunta a esa pastilla, para que el
    // estallido de monedas salga del lugar correcto). `celebrationY` es el
    // punto que usa `computeLayout()` para `bannerY` en este modo.
    this.celebrationY = this.barTop + Math.round(46 * scale);

    // Logo/título: centrado en su franja, debajo del margen de seguridad +
    // el padding superior (ya no necesita el ajuste manual de antes: el
    // padding explícito de arriba/abajo es lo que lo separa del marco).
    this.logoY = safeTop + logoPadTop + logoZoneH * 0.5;
    this.logoX = W / 2;
    this.logoAngle = 0;
    // REORGANIZACIÓN: el logo deja margen a los costados para SONIDO
    // (izquierda) e INFO (derecha), que se mudan acá arriba — antes 0.95
    // (casi todo el ancho). El margen NO puede ser un % fijo (0.72 a secas):
    // `mobileIconR()` tiene un piso de 44px REALES de diámetro, que en
    // pantallas angostas (iPhone SE, Android de 360px) ocupa una fracción
    // MAYOR del ancho de diseño (siempre 1080, fijo) que en una pantalla
    // ancha — un % fijo no le dejaba sitio ahí y los iconos se salían de
    // pantalla (confirmado con el script de verificación). Se reserva el
    // espacio REAL que ocupan los dos iconos + sus huecos ANTES de fijar
    // logoMaxW — mismo patrón de "cota reservada antes de medir" que
    // estPanelPad en escritorio.
    const topIconR = this.mobileIconR();
    const topIconGap = W * 0.025;
    const topIconEdgeMargin = W * 0.015;
    const logoMaxAvailable = W - 2 * (topIconGap + topIconR * 2 + topIconEdgeMargin);
    this.logoMaxW = Math.min(W * 0.82, logoMaxAvailable);
    this.logoMaxH = logoZoneH;

    // CORRECCIÓN 5 (punto 2) + CORRECCIÓN 6 (punto 2, bugfix): React
    // (SlotGameCanvas.tsx) necesita saber dónde empieza el footer para anclar
    // ahí el panel de control DOM, como FRACCIÓN (0-1) de la altura REAL de
    // la ventana. `this.barTop / H` (H=1920, resolución de diseño) NO sirve
    // directamente: con Scale.FIT el lienzo queda "letterboxeado" (más chico
    // que la pantalla real, centrado verticalmente) en cualquier teléfono
    // cuya proporción no sea EXACTAMENTE 1080:1920 — esa fracción de diseño
    // ignoraba el hueco vacío que autoCenter deja ARRIBA del lienzo, así que
    // en los dispositivos con más letterbox (430x932, 390x844) el panel
    // quedaba más abajo de lo real y cortaba las pastillas CRÉDITO/APUESTA
    // por la mitad. La conversión correcta pasa por las medidas REALES que
    // expone el propio ScaleManager: dónde empieza el lienzo dentro de su
    // contenedor (`parentSize` vs `displaySize`) más qué tan abajo cae
    // `barTop` DENTRO de ese lienzo ya escalado.
    // CORRECCIÓN 6 (punto 2) + CORRECCIÓN padding footer (v2): el panel
    // ancla exactamente en `this.barTop` (= borde del marco + panelGap) —
    // ahí es EXACTAMENTE donde arranca todo el contenido del footer ahora
    // (ver arriba), así que panel DOM y contenido de Phaser se mueven juntos.
    const panelAnchorDesign = this.barTop;
    const parent = this.scale.parentSize.height;
    const canvasReal = this.scale.displaySize.height;
    const canvasTopReal = (parent - canvasReal) / 2;
    const anchorReal = canvasTopReal + (panelAnchorDesign / H) * canvasReal;
    const footerTopFrac = parent > 0 ? anchorReal / parent : panelAnchorDesign / H;
    // DIAGNÓSTICO (temporal): el panel del footer (fondo morado del HUD
    // móvil) vive en el DOM y se posiciona con este % — si sale fuera de
    // [0,1), o muy cerca de 1, el panel queda empujado fuera de `.slot-frame`
    // (que tiene overflow:hidden) y su fondo desaparece aunque los botones
    // de Phaser (que no dependen de esta fracción) se vean bien.
    // eslint-disable-next-line no-console
    console.log("MOBILE_FOOTER_TOP", { footerTopFrac, parent, canvasReal, canvasTopReal, anchorReal, panelAnchorDesign, H });
    this.game.events.emit("mobile-footer-top", footerTopFrac);

    // MISMA conversión que arriba, pero anclada a `this.logoY`: React
    // (PlayPage.tsx) la usa para alinear el ícono de HOME del header (DOM, un
    // árbol aparte del canvas) con el de SONIDO (Phaser, al otro lado del
    // logo) — pedido explícito, se veían a alturas distintas.
    const topIconAnchorReal = canvasTopReal + (this.logoY / H) * canvasReal;
    const topIconYFrac = parent > 0 ? topIconAnchorReal / parent : this.logoY / H;
    this.game.events.emit("mobile-top-icon-y", topIconYFrac);
  }

  // ====================================================================== //
  // SISTEMA DE LAYOUT POR ORIENTACIÓN                                       //
  // computeLayout(width, height) decide el modo y fija TODA la geometría:   //
  //  - "portrait": diseño móvil de siempre (computeLayoutMobile, intacto).  //
  //  - "landscape": diseño horizontal (desktop/layoutDesktop.ts, con todos  //
  //    sus números en CONFIG_DESKTOP).                                      //
  // Se llama en create() y en cada resize (debounce, ver onResize); en      //
  // horizontal el resize SOLO reposiciona (applyDesktopLayout), no recrea.  //
  // ====================================================================== //
  private computeLayout(width: number, height: number) {
    this.W = width;
    this.H = height;
    this.portrait = height > width;

    if (this.isMobile) {
      // MÓVIL / VERTICAL: idéntico a antes — geometría de CONFIG_MOBILE.
      this.computeLayoutMobile();
      this.topInfoY = Math.max(28, this.gridY - this.panelPad * 1.1);
      this.bannerY = this.portrait ? this.celebrationY : this.topInfoY;
      this.winMaxW = this.portrait ? this.gridW * 0.82 : this.gridW * 0.5;
      return;
    }

    const frameAsset = this.textures.exists(TEX.gridFrame)
      ? (() => {
          const src = this.textures.get(TEX.gridFrame).getSourceImage();
          return { width: src.width, height: src.height };
        })()
      : null;
    const L = computeDesktopLayout(width, height, { cols: this.cols, rows: this.rows, frameAsset });
    this.L = L;
    this.gridX = L.grid.x;
    this.gridY = L.grid.y;
    this.size = L.grid.cellW;
    this.cellH = L.grid.cellH;
    this.gridW = L.grid.w;
    this.gridH = L.grid.h;
    this.panelPad = L.panelPad;
    this.logoX = L.logo.cx;
    this.logoY = L.logo.cy;
    this.logoMaxW = L.logo.maxW;
    this.logoMaxH = L.logo.maxH;
    this.logoAngle = 0;
    this.barTop = L.bar.rect.y;
    this.footerH = L.bar.rect.h;
    this.topInfoY = L.winBanner.cy;
    this.bannerY = L.winBanner.cy;
    this.winMaxW = L.winBanner.maxW;
  }

  // Resize: debounce (CONFIG_DESKTOP.resizeDebounceMs). En táctil, igual que siempre.
  private onResize(size: Phaser.Structs.Size) {
    if (this.isTouchDevice) {
      this.onResizeTouch(size);
      return;
    }
    window.clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => this.onDesktopResize(), CONFIG_DESKTOP.resizeDebounceMs);
  }

  // Dispositivo táctil: el diseño móvil se fija al arrancar (ver config.ts) y no se
  // recalcula en cada resize (mismo comportamiento de siempre). Única excepción: si
  // el juego ARRANCÓ con el teléfono en horizontal (tapado por el aviso de "gira tu
  // teléfono"), al ponerlo vertical se recalcula la resolución de diseño.
  private onResizeTouch(size: Phaser.Structs.Size) {
    if (this.busy) return;
    const pw = this.scale.parentSize.width;
    const ph = this.scale.parentSize.height;
    if (this.W > this.H && ph > pw && pw > 0) {
      this.scale.setGameSize(CONFIG_MOBILE.design.width, Math.round(CONFIG_MOBILE.design.width * (ph / pw)));
      return; // setGameSize vuelve a emitir "resize" → la comparación de abajo reinicia
    }
    if (Math.abs(size.width - this.W) < 2 && Math.abs(size.height - this.H) < 2) return;
    this.scene.restart();
  }

  private onDesktopResize() {
    if (!this.sys.isActive()) return;
    if (this.busy || this.winOverlayActive) {
      this.pendingRelayout = true; // se aplica al terminar el giro / la celebración
      return;
    }
    this.pendingRelayout = false;
    const pw = this.scale.parentSize.width;
    const ph = this.scale.parentSize.height;
    if (!pw || !ph) return;
    const mode = chooseLayoutMode(pw, ph, false);
    if (mode !== this.layoutMode) {
      this.switchLayoutMode(mode, pw, ph);
      return;
    }
    if (mode === "portrait") {
      // Diseño móvil en una ventana VERTICAL de PC: se reconstruye solo si su alto
      // de diseño cambió de forma apreciable (el diseño móvil no se reposiciona en vivo).
      const d = portraitDesignSize(pw, ph);
      if (Math.abs(d.height - this.H) / this.H > 0.06) {
        this.scale.setGameSize(d.width, d.height);
        this.scene.restart();
      }
      return;
    }
    const d = desktopDesignSize(pw, ph);
    let k = desktopRenderScale(d, pw, ph, window.devicePixelRatio);
    if (Math.abs(k - this.renderScale) / this.renderScale < CONFIG_DESKTOP.render.minRelativeChange) k = this.renderScale;
    const bw = Math.round(d.width * k);
    const bh = Math.round(d.height * k);
    if (bw !== this.scale.width || bh !== this.scale.height) this.scale.setGameSize(bw, bh);
    if (k !== this.renderScale) {
      this.renderScale = k;
      this.hud?.setTextResolution(k);
      if (this.logoImg instanceof Phaser.GameObjects.Text) this.crisp(this.logoImg);
      if (this.fsBadgeText) this.crisp(this.fsBadgeText);
    }
    this.registry.set("desktopDesign", d);
    this.applyCamera(d.width, d.height);
    if (d.width !== this.W || d.height !== this.H || !this.L) {
      this.computeLayout(d.width, d.height);
      this.applyDesktopLayout();
    }
  }

  // La ventana cruzó el umbral vertical/horizontal: único caso en que se recrea la
  // escena (los dos diseños son distintos). Saldo/apuesta/turbo/sonido persisten
  // vía registry, igual que siempre.
  private switchLayoutMode(mode: LayoutMode, pw: number, ph: number) {
    const d = mode === "portrait" ? portraitDesignSize(pw, ph) : desktopDesignSize(pw, ph);
    const k = mode === "portrait" ? 1 : desktopRenderScale(d, pw, ph, window.devicePixelRatio);
    this.registry.set("layoutMode", mode);
    this.registry.set("isMobile", mode === "portrait");
    if (mode === "landscape") this.registry.set("desktopDesign", d);
    this.scale.setGameSize(Math.round(d.width * k), Math.round(d.height * k));
    this.scene.restart();
  }

  // Zoom de cámara = resolución interna / resolución de diseño: todo se sigue
  // posicionando en px de DISEÑO; la cámara lo lleva a los píxeles reales.
  private applyCamera(designW: number, designH: number) {
    const cam = this.cameras.main;
    cam.setZoom(this.renderScale);
    cam.centerOn(designW / 2, designH / 2);
  }

  /** Text nítido con el zoom actual (no-op en móvil). */
  private crisp(...texts: Phaser.GameObjects.Text[]) {
    if (this.isMobile) return;
    for (const t of texts) if (t.active && t.style.resolution !== this.renderScale) t.setResolution(this.renderScale);
  }

  // ====================================================================== //
  // CONSTRUCCIÓN DEL MODO HORIZONTAL (una sola vez por escena)              //
  // ====================================================================== //
  private createDesktop() {
    const pw = this.scale.parentSize.width || this.scale.width;
    const ph = this.scale.parentSize.height || this.scale.height;
    const d = (this.registry.get("desktopDesign") as { width: number; height: number } | undefined) ?? desktopDesignSize(pw, ph);
    this.renderScale = this.scale.width / d.width;
    this.applyCamera(d.width, d.height);
    this.computeLayout(d.width, d.height);
    this.prepareDesktopAssets();

    const DEPTH = CONFIG_DESKTOP.depth;
    this.buildCanvasBackground(1);
    if (this.textures.exists(TEX.gridFrame)) {
      this.gridFrameImg = this.add.image(0, 0, TEX.gridFrame).setDepth(DEPTH.frame);
    } else {
      this.framePanel = this.add.graphics().setDepth(DEPTH.frame);
    }
    this.buildReels();
    this.winGfx = this.add.graphics().setDepth(DEPTH.winLines);
    this.buildDesktopLogo();
    for (const side of ["left", "right"] as const) {
      const key = side === "left" ? TEX.characterLeft : TEX.characterRight;
      if (this.textures.exists(key)) {
        this.charImgs[side] = this.add.image(0, 0, key).setOrigin(0.5, 1).setDepth(DEPTH.characters).setVisible(false);
      }
    }
    this.buildDesktopHud();
    this.buildWinFx();
    this.applyDesktopLayout();
    // El HOME del header DOM vuelve a su sitio de escritorio (si veníamos de vertical).
    this.game.events.emit("mobile-top-icon-y", CONFIG_DESKTOP.headerIconYFrac);
    // El contenedor pudo cambiar entre el arranque y ahora: una medición inicial.
    this.onResize(this.scale.gameSize);
  }

  // Recursos pre-renderizados (se cachean en el juego; sobreviven a reinicios).
  private prepareDesktopAssets() {
    const T = CONFIG_DESKTOP.text;
    ensureDigitFont(this, T.bitmapFontKey, { family: DESKTOP_FONT, weight: "800", bakeSize: T.bakeSize, extraChars: this.curSymbol });
    ensureRaysTexture(this, SlotScene.RAYS_TEX, CONFIG_DESKTOP.effects.raysTextureSize);
    // Sombra + contorno de cada símbolo horneados una vez (antes: 2 preFX por sprite y frame).
    const maxSide = 512;
    for (const code of this.symbolPool()) bakeSymbolTexture(this, `sym-${code}`, `sym-${code}${SlotScene.BAKED_SUFFIX}`, maxSide);
  }

  private buildDesktopLogo() {
    const DL = CONFIG_DESKTOP.logo;
    this.logoCont = this.add.container(0, 0).setDepth(CONFIG_DESKTOP.depth.logo);
    const floatTargets: Phaser.GameObjects.GameObject[] = [];
    if (this.textures.exists(TEX.logo)) {
      const img = this.add.image(0, 0, TEX.logo);
      // Destello ocasional: una copia blanca en ADD que aparece/desaparece cada
      // `sheenEveryMs` (antes: FX "Shine" + sombra por postFX en CADA frame).
      const sheen = this.add.image(0, 0, TEX.logo).setTintFill(0xffffff).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
      this.logoCont.add([img, sheen]);
      this.logoImg = img;
      this.logoSheen = sheen;
      floatTargets.push(img, sheen);
      this.time.addEvent({
        delay: DL.sheenEveryMs,
        loop: true,
        callback: () => {
          if (!this.busy) this.tweens.add({ targets: sheen, alpha: { from: 0, to: 0.2 }, duration: 420, yoyo: true, ease: "Sine.easeInOut" });
        },
      });
    } else {
      const fontSize = Math.round(Math.min(this.logoMaxW * 0.16, this.logoMaxH * 0.8));
      const title = this.goldGradientText(0, 0, this.runtime.theme?.title ?? "SLOT", fontSize, "#3d230a", ["#fff6c8", "#ffd23f", "#b5790a"], 10);
      this.crisp(title);
      this.logoCont.add(title);
      this.logoImg = title;
      floatTargets.push(title);
    }
    // Entrada (una vez) + flotación suave (solo transform; muy barata).
    this.logoCont.setScale(0.6).setAlpha(0);
    this.tweens.add({ targets: this.logoCont, scale: 1, alpha: 1, duration: 550, ease: "Back.easeOut" });
    this.tweens.add({ targets: floatTargets, y: -DL.floatPx, duration: 1700, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  }

  private buildDesktopHud() {
    const hud = new DesktopHud(
      this,
      {
        onSpin: () => this.onSpin(),
        onBet: (dir) => this.changeBet(dir),
        onAuto: () => this.toggleAuto(),
        onTurbo: () => this.toggleTurbo(),
        onMusic: () => this.toggleMusic(),
        onInfo: () => this.runtime.onShowPaytable?.(),
      },
      this.accent
    );
    this.hud = hud;
    hud.setTextResolution(this.renderScale);
    this.balanceValue = hud.credit.text;
    this.creditPill = hud.credit;
    this.betValue = hud.bet.text;
    this.betPill = hud.bet;
    this.winValue = hud.win.text;
    // GANANCIA vive en la barra: no se oculta durante los premios (contenedor vacío
    // para el código compartido que hace winGroup.setVisible()).
    this.winGroup = this.add.container(0, 0);
    this.balanceValue.setText(this.money(this.balance));
    this.betValue.setText(this.money(this.bet));
    this.winValue.setText(this.money(0));
    this.turboToggle = { setActive: (on) => hud.setTurbo(on) };
    this.autoToggle = { setActive: (on) => hud.setAuto(on) };
    this.musicToggleDesktop = { setActive: (on) => hud.setMusic(on) };
    this.turboToggle.setActive(this.turbo);
    this.autoToggle.setActive(false);
    this.musicToggleDesktop.setActive(!this.musicMuted);
  }

  // Emisores de partículas PERSISTENTES (pool interno de Phaser): se reutilizan con
  // explode() en cada premio grande en vez de crear/destruir emisores.
  private buildWinFx() {
    const OV = CONFIG_DESKTOP.depth.overlays;
    this.coinFx = this.add
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
      .setDepth(OV + 5);
    this.confettiFx = this.add
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
      .setDepth(OV + 5);
  }

  // Fondo dentro del canvas (escritorio): degradado del tema (si aplica) + imagen
  // "cover" SIN FX + viñeta horneada. Sin blur, sin postFX, sin parallax: tres
  // quads estáticos. Un fondo GIF/video sigue siendo DOM (canvas transparente).
  private buildCanvasBackground(shadeAlpha: number) {
    const DEPTH = CONFIG_DESKTOP.depth;
    const t = this.runtime.theme;
    if (t?.background_type === "GRADIENT" && (t.background_gradient || "").includes(",")) {
      this.bgGradient = this.add.graphics().setDepth(DEPTH.background);
    }
    if (this.textures.exists(TEX.bg)) this.bgImg = this.add.image(0, 0, TEX.bg).setDepth(DEPTH.background + 1);
    ensureVignetteTexture(this, SlotScene.VIGNETTE_TEX);
    this.bgShade = this.add.image(0, 0, SlotScene.VIGNETTE_TEX).setOrigin(0).setAlpha(shadeAlpha).setDepth(DEPTH.background + 2);
  }

  private layoutCanvasBackground() {
    const W = this.W;
    const H = this.H;
    if (this.bgGradient) {
      const cols = (this.runtime.theme?.background_gradient || "").split(",").map((c) => c.trim()).filter(Boolean);
      const top = hexToNum(cols[0], 0x101827);
      const bot = hexToNum(cols[cols.length - 1], 0x05030f);
      this.bgGradient.clear().fillGradientStyle(top, top, bot, bot, 1).fillRect(0, 0, W, H);
    }
    if (this.bgImg) {
      const src = this.bgImg.texture.getSourceImage();
      const s = Math.max(W / src.width, H / src.height);
      // "cover" centrado, con el mismo sesgo vertical que la capa DOM móvil (40%).
      this.bgImg.setScale(s).setPosition(W / 2, (H - src.height * s) * 0.4 + (src.height * s) / 2);
    }
    this.bgShade?.setPosition(0, 0).setDisplaySize(W, H);
  }

  /** Reposiciona/reescala TODO el modo horizontal desde `this.L` (sin recrear nada). */
  private applyDesktopLayout() {
    const L = this.L;
    if (!L) return;
    this.layoutCanvasBackground();
    if (this.gridFrameImg && L.frameImage) {
      this.gridFrameImg.setPosition(L.frameImage.cx, L.frameImage.cy).setScale(L.frameImage.scale);
    }
    if (this.framePanel) this.drawDesktopPanel(this.framePanel, L);
    this.reels.forEach((r, c) => r.layout(L.grid.x + c * L.grid.cellW, L.grid.y, L.grid.cellW, L.grid.cellH));
    this.reelsMask?.clear().fillStyle(0xffffff).fillRect(L.grid.x, L.grid.y, L.grid.w, L.grid.h);
    // Las rayas de premio se redibujan solas en el siguiente paso del ciclo.
    this.winGfx.clear();

    if (this.logoCont && this.logoImg) {
      this.logoCont.setPosition(L.logo.cx, L.logo.cy);
      if (this.logoImg instanceof Phaser.GameObjects.Image) {
        const src = this.logoImg.texture.getSourceImage();
        const s = Math.min(L.logo.maxW / src.width, L.logo.maxH / src.height, 1.25);
        this.logoImg.setScale(s);
        this.logoSheen?.setScale(s);
      }
    }
    for (const side of ["left", "right"] as const) {
      const img = this.charImgs[side];
      if (!img) continue;
      const slot = L.characters[side];
      if (!slot) {
        img.setVisible(false);
        continue;
      }
      const src = img.texture.getSourceImage();
      img.setScale(Math.min(slot.w / src.width, slot.h / src.height));
      img.setPosition(slot.x + slot.w / 2, slot.y + slot.h).setVisible(true);
    }
    this.hud?.layout(L);
    if (this.fsBadge) this.fsBadge.setPosition(L.fsBadge.right - this.fsBadgeW / 2, L.fsBadge.cy);
  }

  // Panel de rodillos por código (temas SIN grid_frame): relleno translúcido + borde
  // dorado, estático (sin tween infinito sobre Graphics).
  private drawDesktopPanel(g: Phaser.GameObjects.Graphics, L: DesktopLayout) {
    const F = CONFIG_DESKTOP.frame;
    const { x, y, w, h } = L.frameVisible;
    const r = Math.round(L.grid.cellH * F.cornerRadiusPct);
    g.clear();
    for (let i = 3; i >= 1; i--) {
      g.fillStyle(F.borderColor, 0.05).fillRoundedRect(x - i * 8, y - i * 8, w + i * 16, h + i * 16, r + i * 6);
    }
    g.fillGradientStyle(F.fillTop, F.fillTop, F.fillBottom, F.fillBottom, F.fillAlpha).fillRoundedRect(x, y, w, h, r);
    g.fillStyle(0xffffff, 0.04).fillRoundedRect(x + 5, y + 5, w - 10, h - 10, Math.max(0, r - 3));
    g.lineStyle(2, F.borderColor, 0.14);
    for (let c = 1; c < this.cols; c++) {
      const cx = L.grid.x + c * L.grid.cellW;
      g.lineBetween(cx, L.grid.y, cx, L.grid.y + L.grid.h);
    }
    g.lineStyle(F.borderWidthPx, F.borderColor, 1).strokeRoundedRect(x, y, w, h, r);
  }

  // Visibilidad de la pestaña: Phaser ya pausa su loop (Game.onHidden); además se
  // pausa la música y se suspende el AudioContext de los efectos sintetizados.
  private onHidden() {
    if (this.music?.isPlaying) {
      this.music.pause();
      this.musicPausedByHide = true;
    }
    sfx.suspend();
  }

  private onVisible() {
    if (this.musicPausedByHide && !this.musicMuted) this.music?.resume();
    this.musicPausedByHide = false;
    sfx.resume();
  }




  private drawBackground() {
    // El fondo (imagen/degradado/color/GIF/video) lo pinta la capa DOM en AMBOS
    // modos (SlotGameCanvas.tsx, "cover" a pantalla completa): el canvas es
    // transparente. Dentro de Phaser solo quedan los destellos ambientales móviles.
    if (this.isMobile) this.buildMobileFloatingFx();
  }


  // Partículas decorativas ambientales (SOLO móvil): drift lento + fade, en
  // bucle infinito, reutilizando la textura de chispa generada en PreloadScene
  // (placeholder — reemplazable por arte del tema, ver mensaje final).
  private buildMobileFloatingFx() {
    const count = 7;
    for (let i = 0; i < count; i++) {
      const startX = Phaser.Math.Between(0, this.W);
      // CORRECCIÓN 6 (punto 1): se mantienen por ENCIMA del panel de control
      // (this.barTop) — antes podían aparecer en cualquier parte de la
      // pantalla, incluida la zona de los botones −/+, donde se veían como
      // rombos sueltos chocando con el HUD.
      const startY = Phaser.Math.Between(0, this.barTop);
      const size = Phaser.Math.Between(Math.round(this.W * 0.03), Math.round(this.W * 0.07));
      // CORRECCIÓN 6 (punto 1): textura circular (el mismo degradado radial
      // real del resplandor, ver PreloadScene) en vez del rombo de TEX.sparkle
      // — que con blendMode ADD se veía como un cuadrado/rombo amarillo suelto.
      const spark = this.add
        .image(startX, startY, TEX.glow)
        .setDepth(-9)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(0)
        .setDisplaySize(size, size)
        .setTint(this.accent);
      const drift = Phaser.Math.Between(60, 140);
      const duration = Phaser.Math.Between(9000, 16000);
      const delay = Phaser.Math.Between(0, 6000);
      this.tweens.add({
        targets: spark,
        y: startY - drift,
        x: startX + Phaser.Math.Between(-40, 40),
        alpha: { from: 0, to: 0.55 },
        duration: duration / 2,
        delay,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }
  }

  // Marco ilustrado de la rejilla (grid_frame del tema): una sola imagen con las
  // celdas YA dibujadas (p. ej. GRILL.png de Dulce Fiesta), que sustituye el
  // panel+borde dorado genéricos de drawPanel(). El rectángulo INTERIOR medido
  // abajo (en fracción del lienzo del asset, no en px fijos: funciona con
  // cualquier imagen que siga el mismo diseño a otra resolución) es la zona de
  // celdas "limpias" dentro del marco decorativo (lazos/blobs que sobresalen
  // por los cuatro lados) — se estira SOLO lo necesario para que ese rectángulo
  // quede exacto detrás de this.gridX/gridY/gridW/gridH (donde Reel.ts ya
  // coloca los símbolos), así el marco decorativo se ve completo alrededor sin
  // mover ni un símbolo.
  private static readonly GRID_FRAME_INNER = { x0: 42 / 1080, y0: 112 / 798, x1: 1019 / 1080, y1: 653 / 798 };

  private drawGridFrameImage(): boolean {
    if (!this.textures.exists(TEX.gridFrame)) return false;
    const src = this.textures.get(TEX.gridFrame).getSourceImage();
    const Wi = src.width, Hi = src.height;
    const F = SlotScene.GRID_FRAME_INNER;
    const ix0 = Wi * F.x0, ix1 = Wi * F.x1, iy0 = Hi * F.y0, iy1 = Hi * F.y1;
    const scaleX = this.gridW / (ix1 - ix0);
    const scaleY = this.gridH / (iy1 - iy0);
    const dispW = Wi * scaleX, dispH = Hi * scaleY;
    const centerX = this.gridX - ix0 * scaleX + dispW / 2;
    const centerY = this.gridY - iy0 * scaleY + dispH / 2;
    this.add.image(centerX, centerY, TEX.gridFrame).setOrigin(0.5).setScale(scaleX, scaleY).setDepth(-5);
    return true;
  }

  private drawPanel() {
    if (this.drawGridFrameImage()) return;
    const pad = this.panelPad;
    const r = Math.round(this.size * 0.22);
    const px = this.gridX - pad;
    const py = this.gridY - pad;
    const pw = this.gridW + pad * 2;
    const ph = this.gridH + pad * 2;
    const radius = { tl: r, tr: r, br: r, bl: r };

    if (this.isMobile) {
      const GOLD = 0xffd23f;
      const DEEP_TOP = 0x241c6b; // azul/morado profundo, algo más claro arriba
      const DEEP_BOTTOM = 0x140f3d; // mismo tono, más oscuro abajo (degradado sutil)
      const glow = this.add.graphics().setDepth(-3);
      for (let i = 3; i >= 1; i--) {
        const gr = { tl: r + i * 6, tr: r + i * 6, br: r + i * 6, bl: r + i * 6 };
        glow.fillStyle(GOLD, 0.05);
        glow.fillRoundedRect(px - i * 8, py - i * 8, pw + i * 16, ph + i * 16, gr);
      }
      const panel = this.add.graphics().setDepth(-2);
      // CORRECCIÓN 6 (punto 6): ~75-80% de opacidad (antes 60-65%, dejaba ver
      // las nubes del fondo detrás de los símbolos) — con un degradado
      // vertical sutil entre dos tonos del mismo azul/morado (no un color plano).
      panel.fillGradientStyle(DEEP_TOP, DEEP_TOP, DEEP_BOTTOM, DEEP_BOTTOM, 0.76, 0.76, 0.8, 0.8);
      panel.fillRoundedRect(px, py, pw, ph, radius);
      const innerR = { tl: r - 3, tr: r - 3, br: Math.max(0, r - 3), bl: Math.max(0, r - 3) };
      panel.fillStyle(0xffffff, 0.04).fillRoundedRect(px + 5, py + 5, pw - 10, ph - 10, innerR);
      // Separadores de columna muy sutiles, dorados (antes blancos — sobre
      // fondo oscuro, blanco puro se veía como una línea dura; dorado tenue
      // se funde mejor con el borde).
      panel.lineStyle(2, GOLD, 0.14);
      for (let c = 1; c < this.cols; c++) {
        const x = this.gridX + c * this.size;
        panel.lineBetween(x, this.gridY, x, this.gridY + this.gridH);
      }
      // Borde dorado — 5-6px REALES (antes ~2-3px, se veía demasiado fino) —
      // + un brillo que pulsa suavemente cada pocos segundos ("brillante").
      const border = this.add.graphics().setDepth(-1);
      const th = Math.max(Math.round(5.5 * designScaleFactor()), Math.round(this.size * 0.022));
      border.lineStyle(th, GOLD, 1).strokeRoundedRect(px, py, pw, ph, radius);
      // Resplandor INTERIOR sutil, pegado justo dentro del borde (distinto del
      // halo exterior de arriba): una segunda línea más gruesa y tenue, en ADD,
      // a unos px hacia adentro del borde dorado.
      const innerGlow = this.add.graphics().setDepth(-1).setBlendMode(Phaser.BlendModes.ADD);
      const innerInset = th + 3;
      innerGlow.lineStyle(Math.max(4, th), GOLD, 0.18).strokeRoundedRect(
        px + innerInset, py + innerInset, pw - innerInset * 2, ph - innerInset * 2,
        { tl: Math.max(0, r - innerInset), tr: Math.max(0, r - innerInset), br: Math.max(0, r - innerInset), bl: Math.max(0, r - innerInset) }
      );
      this.tweens.add({
        targets: [border, innerGlow],
        alpha: 0.5,
        duration: 1700,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
      return;
    }
  }




  private lerpColor(a: number, b: number, t: number): number {
    const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
    const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
    const r = Math.round(ar + (br - ar) * t);
    const g = Math.round(ag + (bg - ag) * t);
    const bl = Math.round(ab + (bb - ab) * t);
    return (r << 16) | (g << 8) | bl;
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
    // Símbolos "flotantes" (sin cuadro gris) + sombra/brillo en ambos diseños.
    // Horizontal: UNA máscara para todos los carretes y sombras HORNEADAS en
    // textura (sin preFX por sprite) — ver Reel/ReelOptions.
    const desktop = !this.isMobile;
    if (desktop) {
      this.reelsRoot = this.add.container(0, 0).setDepth(CONFIG_DESKTOP.depth.reels);
      this.reelsMask = this.make.graphics({});
      this.reelsMask.fillStyle(0xffffff).fillRect(this.gridX, this.gridY, this.gridW, this.gridH);
      this.reelsRoot.setMask(this.reelsMask.createGeometryMask());
    }
    for (let c = 0; c < this.cols; c++) {
      const reel = new Reel(
        this,
        this.gridX + c * this.size,
        this.gridY,
        c,
        this.rows,
        this.size,
        pool,
        true,
        true,
        this.isMobile,
        // Alto de celda: 4:5 en móvil; en horizontal, la proporción de las celdas del marco.
        this.cellH,
        desktop ? { ownMask: false, textureSuffix: SlotScene.BAKED_SUFFIX } : undefined
      );
      this.reels.push(reel);
      this.reelsRoot?.add(reel.root);
    }
  }

  private drawTitle() {
    // Logo: en móvil y escritorio real (Fase 2, punto 3), grande y centrado
    // arriba, con el tratamiento "premium" (degradado/brillo/entrada). El
    // fallback de ventana angosta no táctil (último `else`) queda intacto.
    if (this.textures.exists(TEX.logo)) {
      const logo = this.add.image(this.logoX, this.logoY, TEX.logo).setOrigin(0.5).setDepth(3);
      this.fitImage(logo, this.logoMaxW, this.logoMaxH);
      logo.setAngle(this.logoAngle);
      if (this.isMobile || !this.portrait) {
        // CORRECCIÓN 5 (punto 3c): `addGlow` sigue la SILUETA de alfa de la
        // textura — si el logo subido por el casino no es un PNG con alfa
        // perfectamente limpio (fondo semi-opaco, JPEG, etc.), el resplandor
        // se dibuja alrededor del RECTÁNGULO completo de la imagen, no de su
        // contenido visible: eso es el "cuadradito claro" que aparecía junto
        // al logo. Se quita el glow (deja sombra + brillo, que si acaso se
        // notan, se funden mejor con un fondo no transparente).
        logo.preFX?.addShadow(0, 0.08, 0.03, 1, 0x000000, 6, 0.5);
        this.logoEntranceAndShine(logo);
      }
      // Flotación suave (bonito, animado).
      this.tweens.add({
        targets: logo, y: this.logoY - 7, duration: 1700, yoyo: true, repeat: -1, ease: "Sine.easeInOut",
      });
    } else if (this.isMobile || !this.portrait) {
      // CORRECCIÓN 2 (punto 3, móvil) + FASE 2 DESKTOP (punto 3): sin imagen
      // de logo subida, el título de texto usa el tratamiento "premium" —
      // relleno en degradado dorado, contorno marrón oscuro GRUESO y sombra —
      // en vez del texto plano de antes (color sólido + contorno negro fino).
      // El grosor del contorno se pide en "px reales": en móvil eso pasa por
      // `designScaleFactor()` (resolución de diseño fija); en escritorio
      // (Scale.RESIZE) 1 unidad YA es 1px real, así que no hace falta factor.
      const strokeRealPx = this.isMobile ? 10 * designScaleFactor() : 10;
      const fontSize = Math.round(Math.min(this.logoMaxW * 0.16, this.logoMaxH * 0.85));
      const title = this.goldGradientText(
        this.logoX,
        this.logoY,
        this.runtime.theme?.title ?? "SLOT",
        fontSize,
        "#3d230a",
        ["#fff6c8", "#ffd23f", "#b5790a"],
        Math.round(strokeRealPx)
      );
      title.setAngle(this.logoAngle);
      this.logoEntranceAndShine(title);
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

  // CORRECCIÓN 2 (punto 3, móvil) + FASE 2 DESKTOP (punto 3): animación de
  // entrada (escala+fade con rebote) y un brillo que recorre el logo cada
  // pocos segundos, usando el FX "Shine" nativo de Phaser (sweep de luz
  // diagonal) — reutilizado por móvil Y escritorio real, sea el logo una
  // imagen del tema o el texto de respaldo. El fallback de ventana angosta no
  // táctil no la usa (sigue con el logo estático de siempre).
  private logoEntranceAndShine(target: Phaser.GameObjects.Image | Phaser.GameObjects.Text) {
    const finalScale = target.scale;
    target.setScale(finalScale * 0.6).setAlpha(0);
    this.tweens.add({
      targets: target,
      scale: finalScale,
      alpha: 1,
      duration: 550,
      ease: "Back.easeOut",
    });
    target.preFX?.addShine(0.3, 0.12, 3);
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


  // Estira la imagen a (w, h) EXACTOS, en X e Y por separado, sin respetar su
  // proporción original y SIN el tope de escala 1 de `fitImage` (que nunca agranda
  // más allá del tamaño nativo del archivo). Para banners pequeños subidos por el
  // casino que deben verse grandes aunque se deformen un poco — el jugador los lee
  // como una franja decorativa, no como una foto que deba quedar perfecta.
  private stretchImage(img: Phaser.GameObjects.Image, w: number, h: number) {
    const t = img.texture.getSourceImage();
    img.setScale(w / t.width, h / t.height);
  }







  // ====================================================================== //
  // HUD MÓVIL (Fase 3) — módulo aislado: solo se llama cuando this.isMobile //
  // es true. Reescritura completa del footer inspirada en Pragmatic;       //
  // escritorio sigue usando buildControls() de arriba, sin tocar.          //
  // Conecta a la MISMA lógica de siempre (onSpin/changeBet/toggleAuto/     //
  // toggleTurbo/onShowPaytable) — nada de eso se modificó.                 //
  // ====================================================================== //
  // ====================================================================== //
  // REORGANIZACIÓN móvil (pedido explícito, captura de referencia "Sugar
  // Land"): antes esta fila era CRÉDITO/APUESTA · SPIN+−/+ · iconos(5) ·
  // ronda. Ahora:
  //   Arriba (junto al logo): SONIDO (izq) / INFO (der)
  //   Fila A: MENÚ — SPIN — AUTO (sin TURBO, −/+ ya NO flanquean el SPIN)
  //   Fila B: pastilla APUESTA con −/+ a los costados
  //   Fila C: 2 estadísticas — GANANCIA / CRÉDITO (sin eco de APUESTA: redundante con la Fila B)
  //   Fila D: texto legal (ronda)
  // Misma técnica de siempre (filas SECUENCIALES con huecos repartidos —
  // Corrección 4/6 punto 0/4 — imposible que se solapen), solo cambia QUÉ va
  // en cada fila.
  // ====================================================================== //
  private buildControlsMobile() {
    const barTop = this.barTop;
    const barH = this.footerH;
    const W = this.W;
    this.debugBoxes = [];
    const L = CONFIG_MOBILE.layout;

    // ---- SONIDO: junto al logo, arriba (ver computeLayoutMobile — logoMaxW
    // se achicó a propósito para dejarle sitio, usando el MISMO mobileIconR()
    // que acá). El botón de INFO que antes flanqueaba el logo del otro lado se
    // quitó: es el mismo botón que el MENÚ de la Fila A de abajo (ambos abren
    // la tabla de pagos) — tenerlo dos veces era redundante.
    const iconR = this.mobileIconR();
    const topIconGap = W * 0.025;
    const soundX = this.logoX - this.logoMaxW / 2 - topIconGap - iconR;
    // Imagen real del tema (music_on/music_off) si existe, igual que el
    // resto del HUD; si no, el botón "candy" verde genérico de respaldo.
    const hasMusicImg = this.textures.exists(TEX.musicOn) || this.textures.exists(TEX.musicOff);
    this.musicToggleMobile = hasMusicImg
      ? this.mobileToggleIcon(soundX, this.logoY, iconR, "♪", "SONIDO", () => this.toggleMusic(), false, TEX.musicOn, TEX.musicOff)
      : this.mobileCandyToggle(soundX, this.logoY, iconR, "♪", () => this.toggleMusic());
    this.musicToggleMobile.setActive(!this.musicMuted);
    this.debugRegisterBox("SONIDO", soundX, this.logoY, iconR * 2, iconR * 2);

    // ====================================================================//
    // Distribución SECUENCIAL del footer, de arriba a abajo — cada fila se
    // calcula a partir del borde inferior de la anterior + un espacio mínimo
    // (`gap`): es IMPOSIBLE que se solapen. Si sobra alto, ese espacio se
    // reparte entre los huecos (Corrección 6, punto 4).
    // ====================================================================//
    const spinR = (W * L.spinDiameterPct) / 2; // 22-24% del ancho de PANTALLA
    // CORRECCIÓN 4 (punto 5): −/+ con mínimo de 52px REALES de diámetro.
    const btnR = Math.max((W * L.betBtnDiameterPct) / 2, 26 * designScaleFactor());
    const betRowH = btnR * 2;
    const statH = W * L.featureHPct; // mismo alto que la vieja fila CRÉDITO/APUESTA
    const legalH = W * L.legalRowHPct;
    const gapMin = W * L.gapMinPct;

    const rowHeights = [spinR * 2, betRowH, statH, legalH];
    const totalFixed = rowHeights.reduce((a, b) => a + b, 0);
    const interiorGaps = rowHeights.length;
    // `trailingGap` (margen fijo y chico antes del borde del panel) usa
    // `gapMin` como tope; `gap` (huecos interiores) usa TODO lo que sobre —
    // nunca negativo (Corrección 7, punto 3).
    const trailingGap = Math.max(0, Math.min(gapMin, barH - totalFixed));
    const gap = Math.max(0, (barH - totalFixed - trailingGap) / interiorGaps);

    let cursor = barTop + gap;
    const spinY = cursor + spinR;
    cursor += spinR * 2 + gap;
    const betY = cursor + betRowH / 2;
    cursor += betRowH + gap;
    const statY = cursor + statH / 2;
    cursor += statH + gap;
    const legalY = cursor + legalH / 2;

    // ---- Fila A: MENÚ — SPIN — AUTO -----------------------------------------
    // TURBO se quitó de esta fila (no tiene equivalente en la referencia del
    // tema candy); sigue siendo activable por teclado (mantener espacio, ver
    // onSpin) aunque no tenga botón propio aquí — mismo criterio que el
    // fallback de escritorio angosto, que tampoco lo muestra.
    // MENÚ/AUTO más grandes que los −/+ de la pastilla de apuesta (pedido
    // explícito): btnR es chico (comparte tamaño con esos botones), así que
    // acá usan su propio radio, más cerca del tamaño del GIRO.
    const sideBtnR = spinR * 0.72;
    const sideGap = spinR + sideBtnR + W * 0.04;
    const menuX = W / 2 - sideGap;
    const autoX = W / 2 + sideGap;

    // Botón de giro: imagen del tema (spin_button) si existe, igual que en
    // escritorio; si no, el disco+anillo+resplandor genéricos de siempre.
    const hasSpinImg = this.textures.exists(TEX.spinBtn);
    let spinIdlePulse: Phaser.Tweens.Tween | undefined;
    if (hasSpinImg) {
      const spinImg = this.add.image(W / 2, spinY, TEX.spinBtn).setDepth(7);
      this.fitImage(spinImg, spinR * 2.3, spinR * 2.3);
      spinIdlePulse = this.tweens.add({
        targets: spinImg, scale: spinImg.scale * 1.045, duration: 1800, yoyo: true, repeat: -1, ease: "Sine.easeInOut",
      });
      this.spinChip = spinImg;
    } else {
      // Resplandor suave detrás del disco (ADD, dorado).
      const spinGlow = this.add
        .image(W / 2, spinY, TEX.glow)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(0xffd23f)
        .setDisplaySize(spinR * 2.6, spinR * 2.6)
        .setAlpha(0.4)
        .setDepth(6);
      this.tweens.add({ targets: spinGlow, alpha: 0.7, duration: 1500, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

      // Disco oscuro semitransparente con borde claro + flechas blancas.
      this.spinChip = this.mobileRoundChip(W / 2, spinY, spinR, 0x0b0f1a, 0.55, 0xffffff, 0.85);
      // Anillo EXTERIOR dorado, separado del borde blanco del disco.
      const spinRing = this.add.graphics().setDepth(7).setPosition(W / 2, spinY);
      spinRing.lineStyle(Math.max(3, Math.round(spinR * 0.05)), 0xffd23f, 0.95).strokeCircle(0, 0, spinR * 1.06);
      // Pulso LENTO de escala en reposo (disco + anillo juntos) — se pausa
      // mientras gira, como el pulso del glifo (ver onSpin/finally existentes).
      spinIdlePulse = this.tweens.add({
        targets: [this.spinChip, spinRing],
        scale: 1.045,
        duration: 1800,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }

    // Textura TOTALMENTE transparente a propósito: `setButtonEnabled()` le
    // pone alpha:1 al habilitarlo, y con una textura visible eso taparía el
    // disco de arriba. El glifo (`buttonLabel`) es el que de verdad se ve y
    // el que sí se atenúa al deshabilitar.
    this.button = this.add
      .image(W / 2, spinY, TEX.transparentPixel)
      .setDisplaySize(spinR * 2, spinR * 2)
      .setDepth(8)
      .setInteractive({ useHandCursor: true });
    this.buttonLabel = this.add
      .text(W / 2, spinY, hasSpinImg ? "" : "⟳", {
        fontFamily: MOBILE_FONT,
        fontSize: `${Math.round(spinR * 1.1)}px`,
        fontStyle: "700",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setShadow(0, 2, "#000000", 6, true, true)
      .setDepth(9);
    // Feedback táctil (squash+destello) + el icono gira 360° al activarse.
    this.button.on("pointerdown", () => {
      this.mobilePressFeedback(W / 2, spinY, spinR, [this.buttonLabel]);
      this.tweens.add({
        targets: this.buttonLabel,
        angle: this.buttonLabel.angle + 360,
        duration: 500,
        ease: "Cubic.easeOut",
      });
      this.onSpin();
    });
    this.pulse = this.tweens.add({
      targets: this.buttonLabel,
      scale: 1.08,
      duration: 750,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
    // El pulso lento del disco/anillo se pausa/retoma junto con el del glifo
    // (mismo ciclo de vida: pausa al girar, retoma al terminar — ver
    // setButtonEnabled() más abajo, que ya controla `this.pulse`).
    this.spinIdlePulse = spinIdlePulse;
    this.debugRegisterBox("SPIN", W / 2, spinY, spinR * 2.6, spinR * 2.6);

    // MENÚ abre el modal de combinaciones ganadoras (vive en React, igual que
    // INFO en el resto del HUD) y AUTO alterna el autoplay — ambos usan la
    // imagen real del tema (info_button/auto_on/auto_off) si existe.
    this.mobileToggleIcon(menuX, spinY, sideBtnR, "≡", "MENÚ", () => this.runtime.onShowPaytable?.(), false, TEX.infoBtn, TEX.infoBtn);
    this.autoToggle = this.mobileToggleIcon(autoX, spinY, sideBtnR, "∞", "AUTO", () => this.toggleAuto(), false, TEX.autoOn, TEX.autoOff);
    this.debugRegisterBox("MENÚ", menuX, spinY, sideBtnR * 2, sideBtnR * 2);
    this.debugRegisterBox("AUTO", autoX, spinY, sideBtnR * 2, sideBtnR * 2);

    // ---- Fila B: pastilla APUESTA con −/+ a los costados -------------------
    // PEGADOS a la pastilla (leve solape, no un hueco de aire): igual que en
    // la referencia, donde los círculos −/+ son parte del mismo gráfico que
    // el visor central.
    const betPillW = W * 0.4;
    const betGap = -btnR * 0.22;
    const minusX = W / 2 - betPillW / 2 - betGap - btnR;
    const plusX = W / 2 + betPillW / 2 + betGap + btnR;
    // −/+ : imagen del tema (bet_minus/bet_plus) si existe, igual que en
    // escritorio; si no, el disco+glifo genéricos de siempre.
    const hasBetMinusImg = this.textures.exists(TEX.betMinus);
    const hasBetPlusImg = this.textures.exists(TEX.betPlus);
    if (hasBetMinusImg) {
      const img = this.add.image(minusX, betY, TEX.betMinus).setDepth(9);
      this.fitImage(img, btnR * 2.1, btnR * 2.1);
      this.add.zone(minusX, betY, btnR * 2.1, btnR * 2.1).setInteractive({ useHandCursor: true }).setDepth(10)
        .on("pointerdown", () => { this.mobilePressFeedback(minusX, betY, btnR, [img]); this.changeBet(-1); });
    } else {
      this.mobileRoundChip(minusX, betY, btnR, 0x0b0f1a, 0.45, 0xffffff, 0.7);
      this.mobileGlyphButton(minusX, betY, btnR, "−", () => this.changeBet(-1));
    }
    if (hasBetPlusImg) {
      const img = this.add.image(plusX, betY, TEX.betPlus).setDepth(9);
      this.fitImage(img, btnR * 2.1, btnR * 2.1);
      this.add.zone(plusX, betY, btnR * 2.1, btnR * 2.1).setInteractive({ useHandCursor: true }).setDepth(10)
        .on("pointerdown", () => { this.mobilePressFeedback(plusX, betY, btnR, [img]); this.changeBet(1); });
    } else {
      this.mobileRoundChip(plusX, betY, btnR, 0x0b0f1a, 0.45, 0xffffff, 0.7);
      this.mobileGlyphButton(plusX, betY, btnR, "+", () => this.changeBet(1));
    }
    // Mismo alto que los botones −/+ (antes 90%, se veía más bajo que ellos).
    const betPillH = betRowH;
    const betMain = this.mobileInfoPill(W / 2, betY, betPillW, betPillH, "APUESTA", this.money(this.bet), ["#ffc93f", "#a85d00"], TEX.betBanner);
    this.betValue = betMain.valueText;
    this.betPill = betMain;
    this.debugRegisterBox("BET-", minusX, betY, btnR * 2, btnR * 2);
    this.debugRegisterBox("BET+", plusX, betY, btnR * 2, btnR * 2);
    this.debugRegisterBox("APUESTA", W / 2, betY, betPillW, betPillH);

    // ---- Fila C: estadísticas — GANANCIA / CRÉDITO -------------------------
    // Sin el eco de APUESTA: ya se ve en la pastilla de la Fila B, justo
    // arriba — repetirla acá era redundante (pedido explícito). GANANCIA se
    // muda ACÁ (antes vivía pegada al marco, sola) — el texto/banner grande
    // de celebración sigue apareciendo pegado al marco (ver `celebrationY`,
    // computeLayoutMobile), independiente de esta pastilla.
    const statW = W * 0.3;
    const statGap = W * 0.02;
    const statPairGap = statW + statGap;
    const statWinX = W / 2 - statPairGap / 2;
    const statCreditX = W / 2 + statPairGap / 2;

    const ganancia = this.mobileInfoPill(statWinX, statY, statW, statH, "GANANCIA", this.money(0), ["#39e8c7", "#0a6b5c"], TEX.topbarBanner);
    this.winValue = ganancia.valueText;

    // GANASTE (celebración) se centra en el medio de la pantalla, justo
    // donde vive CRÉDITO — si se queda visible durante la celebración, tapa
    // el texto (pedido explícito: "no se quita el de crédito y no se ve").
    // Agrupando las dos pastillas en `winGroup`, el mismo
    // `winGroup.setVisible(false)` que ya oculta GANANCIA oculta también
    // CRÉDITO, sin tocar ninguno de los puntos que ya lo llaman.
    const groupMembers: Phaser.GameObjects.GameObject[] = [ganancia.cont];
    if (CONFIG_MOBILE.features.doubleChance) {
      this.mobileFeatureStub(
        statCreditX, statY, statW, statH,
        ["DOBLAR POSIBILIDAD", "OFF"],
        ["#ff5fa0", "#9c1352"], "toggle"
      );
    } else {
      const credit = this.mobileInfoPill(statCreditX, statY, statW, statH, "CRÉDITO", this.money(this.balance), ["#2be28a", "#0a6b3f"], TEX.balanceBanner);
      this.balanceValue = credit.valueText;
      this.creditPill = credit;
      groupMembers.push(credit.cont);
    }
    this.winGroup = this.add.container(0, 0, groupMembers).setDepth(7);

    this.debugRegisterBox("GANANCIA", statWinX, statY, statW, statH);
    this.debugRegisterBox(CONFIG_MOBILE.features.doubleChance ? "DOBLAR POSIBILIDAD" : "CRÉDITO", statCreditX, statY, statW, statH);
    // De acá en más, `winRowY` = dónde vive la pastilla de GANANCIA (lo usa
    // mobileCoinBurst() para que el estallido de monedas salga del lugar
    // correcto — ver onSpin/present más abajo, sin cambios ahí).
    this.winRowY = statY;

    // REORGANIZACIÓN móvil (pedido explícito): el texto/banner de "¡GANASTE
    // $X!" pasa a aparecer en el medio de APUESTA y CRÉDITO — exactamente
    // donde vive la pastilla de GANANCIA (statWinX===W/2, ya centrado) — en
    // vez de pegado al marco (`celebrationY`, usado solo como valor inicial
    // antes de llegar acá). `winText`/`prizeBannerImg` ya se crearon más
    // arriba en create() con esa posición inicial; se reposicionan ahora que
    // se conoce el valor real — todo pasa en el mismo create() síncrono,
    // antes de que el jugador vea nada, así que no hay salto visible.
    this.bannerY = statY;
    this.winText!.setY(this.bannerY);
    if (this.prizeBannerImg) this.prizeBannerImg.setY(this.bannerY);
    // Ese hueco es angosto (el de la pastilla GANANCIA, flanqueada por
    // APUESTA/CRÉDITO al mismo alto) — el ancho máximo del texto/banner de
    // "GANASTE" (antes gridW*0.82, pensado para flotar solo cerca del
    // marco) se acota para que no se monte sobre esas dos pastillas vecinas.
    this.winMaxW = statW * 1.15;

    // ---- Fila D: texto legal/soporte (ID de ronda) -------------------------
    const legalSize = Math.max(Math.round(W * 0.019), Math.round(11 * designScaleFactor()));
    this.legalText = this.add
      .text(W / 2, legalY, "RONDA —", {
        fontFamily: MOBILE_FONT,
        fontSize: `${legalSize}px`,
        fontStyle: "600",
        color: "#c9d3e6",
      })
      .setOrigin(0.5)
      .setAlpha(0.85)
      .setDepth(7);
    this.debugRegisterBox("RONDA", W / 2, legalY, W * 0.4, legalH);

    this.debugCheckOverlaps();
  }

  // Texto con RELLENO EN DEGRADADO dorado (claro arriba -> oscuro abajo),
  // contorno marrón oscuro y sombra — usado en toda la Fase 3 (GANANCIA,
  // crédito/apuesta). El `CanvasGradient` se crea con el contexto 2D propio
  // del Text (obligatorio: un gradiente de OTRO canvas no sirve aquí).
  private goldGradientText(
    x: number,
    y: number,
    text: string,
    fontSize: number,
    strokeColor = "#5b3a12",
    // Permite reusar la misma técnica con otra paleta (p. ej. los distintos
    // tonos de BIG/MEGA/SUPER/JACKPOT en la Fase 5) — por defecto, el dorado
    // de siempre.
    gradient: [string, string, string] = ["#fff6c8", "#ffd23f", "#b5790a"],
    // CORRECCIÓN 2 (punto 3): el logo pide un contorno de 8-12px REALES de
    // pantalla (no de diseño) — con fontSize grande, la fórmula por defecto
    // (15% del tamaño) se queda corta/larga según el dispositivo. Si se pasa,
    // este valor (en px de diseño) manda sobre la fórmula.
    strokeWidthDesignPx?: number
  ): Phaser.GameObjects.Text {
    const t = this.add
      .text(x, y, text, {
        fontFamily: MOBILE_FONT,
        fontSize: `${fontSize}px`,
        fontStyle: "800",
      })
      .setOrigin(0.5)
      .setDepth(7);
    t.setStroke(strokeColor, strokeWidthDesignPx ?? Math.max(3, Math.round(fontSize * 0.15)));
    t.setShadow(0, 3, "#000000", 5, true, true);
    const grad = t.context.createLinearGradient(0, 0, 0, t.height);
    grad.addColorStop(0, gradient[0]);
    grad.addColorStop(0.45, gradient[1]);
    grad.addColorStop(1, gradient[2]);
    t.setColor(grad);
    return t;
  }

  // CORRECCIÓN 1: registra el bounding box de un elemento del HUD móvil. Si
  // `CONFIG_MOBILE.debug.enabled` es true, además lo dibuja (rectángulo +
  // etiqueta) por encima de todo lo demás. No hace nada si el debug está
  // apagado (y entonces no cuesta nada en producción).
  // CORRECCIÓN 1 (móvil) / Fase 1 desktop: cada modo tiene su propio flag de
  // debug (CONFIG_MOBILE.debug.enabled / CONFIG_DESKTOP.debug.enabled) —
  // activarlo en uno no dibuja nada en el otro.
  private get debugEnabled(): boolean {
    return this.isMobile && CONFIG_MOBILE.debug.enabled;
  }

  private debugRegisterBox(name: string, x: number, y: number, w: number, h: number) {
    if (!this.debugEnabled) return;
    this.debugBoxes.push({ name, x, y, w, h });
    this.add
      .rectangle(x, y, w, h)
      .setStrokeStyle(2, 0x00ff6a, 0.9)
      .setDepth(999);
    this.add
      .text(x - w / 2 + 3, y - h / 2 + 1, name, {
        fontFamily: "monospace",
        fontSize: "15px",
        color: "#00ff6a",
        backgroundColor: "#000000b0",
      })
      .setDepth(1000);
  }

  // CORRECCIÓN 1: compara todos los bounding boxes registrados en esta
  // construcción del HUD entre sí (AABB) y avisa por consola cada par que se
  // intersecta — así un solape como el de SPIN/COMPRAR FUNCIÓN del bug
  // original se detecta solo, sin tener que mirar un screenshot.
  private debugCheckOverlaps() {
    if (!this.debugEnabled) return;
    const boxes = this.debugBoxes;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const overlapX = Math.abs(a.x - b.x) * 2 < a.w + b.w;
        const overlapY = Math.abs(a.y - b.y) * 2 < a.h + b.h;
        if (overlapX && overlapY) {
          console.warn(`[HUD debug] "${a.name}" se solapa con "${b.name}"`, { a, b });
        }
      }
    }
  }



  // Disco semitransparente con borde claro (la "ficha" de cristal detrás de
  // cada botón circular del HUD móvil: giro, −/+, iconos).
  private mobileRoundChip(
    x: number,
    y: number,
    r: number,
    fill: number,
    fillAlpha: number,
    stroke: number,
    strokeAlpha: number
  ) {
    // CORRECCIÓN 4 (punto 5): dibujado en coordenadas LOCALES (0,0) +
    // `setPosition(x,y)` — antes dibujaba en absolutas, lo que hacía INSEGURO
    // animarle la escala (escalaría alrededor de (0,0) de la escena, no de su
    // propio centro, desplazando el círculo). Necesario para el pulso lento
    // del SPIN. `mobileToggleIcon.setActive` también se actualizó a juego.
    const g = this.add.graphics().setDepth(7).setPosition(x, y);
    g.fillStyle(fill, fillAlpha).fillCircle(0, 0, r);
    g.lineStyle(Math.max(2, Math.round(r * 0.045)), stroke, strokeAlpha).strokeCircle(0, 0, r);
    // Arco de brillo en la mitad superior, como un disco de cristal en vez de
    // un círculo plano.
    g.lineStyle(Math.max(1.5, r * 0.03), 0xffffff, strokeAlpha * 0.5);
    g.beginPath();
    g.arc(0, 0, r * 0.86, Math.PI * 1.08, Math.PI * 1.92, false);
    g.strokePath();
    return g;
  }

  // SOLO MÓVIL (Fase 6, regla 1): feedback táctil común — al tocar, un
  // "squash" breve (escala 0.92 con rebote Back.easeOut) en el glifo/texto del
  // botón + un destello (glow ADD) que se desvanece. Reutilizado por todos los
  // botones del HUD móvil nuevos; escritorio no lo usa.
  private mobilePressFeedback(x: number, y: number, r: number, targets: Phaser.GameObjects.GameObject[]) {
    sfx.buttonClick();
    if (targets.length) {
      this.tweens.add({ targets, scale: 0.92, duration: 70, yoyo: true, ease: "Back.easeOut" });
    }
    const flash = this.add
      .image(x, y, TEX.glow)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xffffff)
      .setDisplaySize(r * 2.6, r * 2.6)
      .setAlpha(0.55)
      .setDepth(11);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 1.25,
      duration: 220,
      ease: "Sine.easeOut",
      onComplete: () => flash.destroy(),
    });
  }

  // Glifo blanco nítido + zona táctil para un botón circular del HUD móvil
  // (−/+). El giro usa su propio texto (necesita el pulso independiente).
  // Devuelve `{txt, zone}` (antes no devolvía nada): es un cambio puramente
  // ADITIVO — los llamadores existentes (móvil) simplemente no usan el valor
  // de retorno, así que su comportamiento no cambia. FASE 4 DESKTOP (punto 1)
  // lo necesita para engancharle el hover por fuera, sin tocar este método
  // compartido con móvil.
  private mobileGlyphButton(
    x: number,
    y: number,
    r: number,
    glyph: string,
    onClick: () => void
  ): { txt: Phaser.GameObjects.Text; zone: Phaser.GameObjects.Zone } {
    const txt = this.add
      .text(x, y, glyph, {
        fontFamily: MOBILE_FONT,
        fontSize: `${Math.round(r * 1.15)}px`,
        fontStyle: "700",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setShadow(0, 2, "#000000", 4, true, true)
      .setDepth(9);
    const zone = this.add
      .zone(x, y, r * 2.1, r * 2.1)
      .setInteractive({ useHandCursor: true })
      .setDepth(10)
      .on("pointerdown", () => {
        this.mobilePressFeedback(x, y, r, [txt]);
        onClick();
      });
    return { txt, zone };
  }

  // Ícono circular/pill del HUD móvil (info/auto/turbo/sonido/menú): disco
  // semitransparente, glifo blanco, leyenda en la tipografía cartoon con
  // stroke+shadow. `stub=true` lo deja visible pero sin zona táctil (listo
  // para conectar). Devuelve un `Toggle` para los que SÍ tienen estado
  // (auto/turbo) — los demás ignoran el valor de retorno.
  private mobileToggleIcon(
    x: number,
    y: number,
    r: number,
    glyph: string,
    caption: string,
    onClick?: () => void,
    // CORRECCIÓN 4 (punto 6): `stub` ahora SOLO controla si hay zona táctil —
    // ya NO atenúa el ícono (antes MENÚ se veía "apagado"/deshabilitado por
    // ser stub; debe verse tan activo como cualquier otro, solo que todavía
    // no hace nada al tocarlo).
    stub = false,
    // Imágenes del tema (opcionales, ADITIVO): si el casino subió spin_button/
    // auto_on/auto_off/info_button, se dibuja esa imagen en vez del disco
    // genérico — mismo criterio "tolerante" que makeToggle (escritorio): basta
    // con UNA de las dos (on/off); si falta, se usa la disponible para ambos
    // estados y se distingue activo/inactivo por opacidad. Los llamadores que
    // no pasan estos dos últimos argumentos (SONIDO, INFO junto al logo) se
    // comportan EXACTAMENTE igual que antes.
    onTex?: string,
    offTex?: string
  ): Toggle {
    const onAvail = !!onTex && this.textures.exists(onTex);
    const offAvail = !!offTex && this.textures.exists(offTex);
    const hasImg = onAvail || offAvail;
    const texOn = onAvail ? onTex! : offTex!;
    const texOff = offAvail ? offTex! : onTex!;

    const chip = hasImg ? undefined : this.mobileRoundChip(x, y, r, 0x0b0f1a, 0.45, 0xffffff, 0.7);
    const img = hasImg ? this.add.image(x, y, texOff).setDepth(9) : undefined;
    if (img) this.fitImage(img, r * 2.1, r * 2.1);
    const glyphTxt = hasImg
      ? undefined
      : this.add
          .text(x, y - 1, glyph, {
            fontFamily: MOBILE_FONT,
            fontSize: `${Math.round(r * 0.95)}px`,
            fontStyle: "700",
            color: "#ffffff",
          })
          .setOrigin(0.5)
          .setShadow(0, 2, "#000000", 3, true, true)
          .setDepth(9);
    // CORRECCIÓN 4 (punto 6): etiquetas de texto QUITADAS por defecto (ver
    // CONFIG_MOBILE.layout.showIconCaptions) — si se reactivan, nunca bajan
    // de ~11px reales de pantalla.
    if (CONFIG_MOBILE.layout.showIconCaptions) {
      const capSize = Math.max(Math.round(11 * designScaleFactor()), Math.round(r * 0.34));
      this.add
        .text(x, y + r + Math.round(r * 0.32), caption, {
          fontFamily: MOBILE_FONT,
          fontSize: `${capSize}px`,
          fontStyle: "700",
          color: "#e7ecf7",
        })
        .setOrigin(0.5)
        .setStroke("#000000", 3)
        .setShadow(0, 2, "#000000", 3, true, true)
        .setDepth(9);
    }
    if (!stub && onClick) {
      this.add
        .zone(x, y, r * 2.1, r * 2.1)
        .setInteractive({ useHandCursor: true })
        .setDepth(10)
        .on("pointerdown", () => {
          this.mobilePressFeedback(x, y, r, img ? [img] : [glyphTxt!]);
          onClick();
        });
    }
    const setActive = (on: boolean) => {
      if (img) {
        img.setTexture(on && onAvail ? texOn : texOff);
        img.setAlpha(onAvail || offAvail ? (on || !offAvail ? 1 : 0.6) : 1);
        return;
      }
      // CORRECCIÓN 4: `chip` ahora está POSICIONADO en (x,y) — ver
      // mobileRoundChip — así que se redibuja en LOCAL (0,0), no en (x,y)
      // (si no, se desplazaría: doble offset).
      chip!.clear();
      chip!.fillStyle(0x0b0f1a, on ? 0.65 : 0.45).fillCircle(0, 0, r);
      chip!.lineStyle(Math.max(2, Math.round(r * 0.06)), on ? this.accent : 0xffffff, on ? 1 : 0.7).strokeCircle(0, 0, r);
      chip!.lineStyle(Math.max(1.5, r * 0.03), 0xffffff, 0.35);
      chip!.beginPath();
      chip!.arc(0, 0, r * 0.86, Math.PI * 1.08, Math.PI * 1.92, false);
      chip!.strokePath();
      glyphTxt!.setColor(on ? this.accentHex : "#ffffff");
    };
    return { setActive };
  }

  // Botón "candy" verde glossy — MISMO lenguaje visual que los botones reales
  // del tema (hamburguesa/auto play: cuadrado redondeado, degradado verde,
  // borde claro tipo metal) para controles sin imagen propia en el pack de
  // assets. Hoy solo lo usa SONIDO (no hay un asset de altavoz dedicado); si
  // el tema algún día sube uno, basta con pasarlo a mobileToggleIcon en vez
  // de llamar a este helper. Reemplaza el disco oscuro semitransparente
  // genérico, que no encaja con el resto del HUD ya tematizado.
  private mobileCandyToggle(x: number, y: number, r: number, glyph: string, onClick: () => void): Toggle {
    const rad = r * 0.4;
    const g = this.add.graphics().setDepth(8).setPosition(x, y);
    const glyphTxt = this.add
      .text(x, y - 1, glyph, {
        fontFamily: MOBILE_FONT,
        fontSize: `${Math.round(r * 0.95)}px`,
        fontStyle: "700",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setShadow(0, 2, "#000000", 3, true, true)
      .setDepth(9);
    const draw = (on: boolean) => {
      g.clear();
      const top = on ? 0x8ce562 : 0x4a6b3a;
      const bottom = on ? 0x3c9f1e : 0x294d1c;
      g.fillStyle(0x000000, 0.22).fillRoundedRect(-r, -r * 0.82, r * 2, r * 2, rad);
      g.fillGradientStyle(top, top, bottom, bottom, 1).fillRoundedRect(-r, -r, r * 2, r * 2, rad);
      g.fillStyle(0xffffff, 0.22).fillRoundedRect(-r * 0.82, -r * 0.8, r * 1.64, r * 0.62, rad * 0.7);
      g.lineStyle(Math.max(2, r * 0.08), 0xeaf7e0, 0.95).strokeRoundedRect(-r, -r, r * 2, r * 2, rad);
    };
    draw(true);
    this.add
      .zone(x, y, r * 2.1, r * 2.1)
      .setInteractive({ useHandCursor: true })
      .setDepth(10)
      .on("pointerdown", () => {
        this.mobilePressFeedback(x, y, r, [glyphTxt]);
        onClick();
      });
    return {
      setActive: (on: boolean) => {
        draw(on);
        glyphTxt.setAlpha(on ? 1 : 0.75);
      },
    };
  }

  // CORRECCIÓN 4 (punto 0): pastilla INFORMATIVA (CRÉDITO/APUESTA) — mismo
  // estilo glossy que los botones (degradado, borde claro, highlight
  // superior, sombra inferior), pero SIN zona táctil ni estado de presionado
  // (no son botones). Devuelve el texto del monto (para actualizarlo) y un
  // `pulse()` para la animación corta al cambiar.
  private mobileInfoPill(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    value: string,
    [colorTop, colorBottom]: [string, string],
    // Fondo del tema (opcional, ADITIVO): si el casino subió bet_banner/
    // topbar_banner/balance_banner, se estira esa imagen en vez de dibujar la
    // cápsula con degradado genérico. Los llamadores que no lo pasan (todo lo
    // que ya existía) se comportan EXACTAMENTE igual que antes.
    bgTexKey?: string
  ): { valueText: Phaser.GameObjects.Text; pulse: () => void; cont: Phaser.GameObjects.Container } {
    const r = h * 0.4;
    const cont = this.add.container(x, y).setDepth(7);

    const bodyParts: Phaser.GameObjects.GameObject[] = [];
    if (bgTexKey && this.textures.exists(bgTexKey)) {
      const bg = this.add.image(0, 0, bgTexKey);
      this.stretchImage(bg, w, h);
      bodyParts.push(bg);
    } else {
      const top = hexToNum(colorTop, 0x22d47f);
      const bottom = hexToNum(colorBottom, 0x0a6b3f);
      const shadow = this.add.graphics();
      shadow.fillStyle(0x000000, 0.18).fillRoundedRect(-w / 2 - 2, -h / 2 + h * 0.1, w + 4, h, r);
      shadow.fillStyle(0x000000, 0.3).fillRoundedRect(-w / 2, -h / 2 + h * 0.07, w, h, r);
      const halo = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.35);
      halo.fillStyle(top, 0.5).fillRoundedRect(-w / 2 - 6, -h / 2 - 6, w + 12, h + 12, r + 6);
      const mid = this.lerpColor(top, 0xffffff, 0.18);
      const body = this.add.graphics();
      body.fillGradientStyle(top, top, bottom, bottom, 1).fillRoundedRect(-w / 2, -h / 2, w, h, r);
      body.fillStyle(mid, 0.5).fillRoundedRect(-w / 2 + 3, -h / 2 + 3, w - 6, h * 0.42, r * 0.75);
      body.lineStyle(2.5, 0xffffff, 0.6).strokeRoundedRect(-w / 2, -h / 2, w, h, r);
      const highlight = this.add.graphics();
      highlight.fillStyle(0xffffff, 0.3).fillRoundedRect(-w / 2 + 5, -h / 2 + 3, w - 10, h * 0.3, r * 0.7);
      highlight.fillStyle(0xffffff, 0.12).fillRoundedRect(-w / 2 + 4, -h / 2 + h * 0.3, w - 8, h * 0.2, r * 0.6);
      bodyParts.push(shadow, halo, body, highlight);
    }

    // Etiqueta chica arriba (blanca, bold) + monto grande abajo (blanco con
    // contorno oscuro y sombra) — pedido explícitamente así, distinto del
    // dorado que usan GANANCIA/logo (para separar visualmente "control" de
    // "estado del juego"). En móvil, `h` es un % FIJO de `W` (siempre 1080 en
    // diseño), así que `h*0.17` también es un valor fijo en diseño — pero su
    // tamaño REAL varía con cada dispositivo, y en los más anchos terminaba
    // en apenas ~7px reales, ilegible. Se le pone un piso de ~11.5px reales
    // ahí (pedido: 11-12px) usando `designScaleFactor()` (conversión diseño
    // -> real, solo válida en Scale.FIT). AUDITORÍA DESKTOP (punto 4): este
    // mismo método se reutiliza para las pastillas de escritorio (Fase 3) —
    // ahí `designScaleFactor()` no significa nada real (Scale.RESIZE no
    // tiene resolución de diseño) y por pura coincidencia numérica daba un
    // piso de hasta ~6-10px en pantallas chicas (1280x720), por debajo de lo
    // pedido. En escritorio `h` YA es un px real, así que el piso es un
    // valor fijo de 12px reales, sin conversión.
    const labelSize = Math.max(Math.round(h * 0.17), this.isMobile ? Math.round(11.5 * designScaleFactor()) : 12);
    const labelTxt = this.add
      .text(0, -h * 0.26, label, {
        fontFamily: MOBILE_FONT,
        fontSize: `${labelSize}px`,
        fontStyle: "800",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setStroke("#000000", 3)
      .setShadow(0, 2, "#000000", 3, true, true);
    const valueTxt = this.add
      .text(0, h * 0.13, value, {
        fontFamily: MOBILE_FONT,
        fontSize: `${Math.round(h * 0.34)}px`,
        fontStyle: "800",
        color: "#ffffff",
        wordWrap: { width: w * 0.92 },
      })
      .setOrigin(0.5)
      .setStroke("#1a0f05", Math.max(3, Math.round(h * 0.05)))
      .setShadow(0, 3, "#000000", 5, true, true);

    cont.add([...bodyParts, labelTxt, valueTxt]);

    const baseScale = cont.scale;
    const pulse = () => {
      this.tweens.add({
        targets: cont,
        scale: baseScale * 1.08,
        duration: 130,
        yoyo: true,
        ease: "Sine.easeOut",
      });
    };
    // DIAGNÓSTICO D1b: se añade `cont` al objeto devuelto (antes solo
    // `valueText`/`pulse`) — mismo cambio PURAMENTE ADITIVO que ya se hizo en
    // mobileGlyphButton (ver su comentario): los llamadores existentes
    // (móvil) siguen desestructurando solo lo que ya usaban, así que esto no
    // les cambia nada. Hace falta para poder registrar el contenedor real
    // de CRÉDITO/APUESTA con debugTrack() y ver su `depth` en el volcado.
    return { valueText: valueTxt, pulse, cont };
  }

  // Botón de función "glossy" (COMPRAR FUNCIÓN / DOBLAR POSIBILIDAD): hoy son
  // STUBS deshabilitados (el backend no soporta ninguna de las dos todavía) —
  // visibles, con la estética de la referencia, pero sin zona táctil. Cuando
  // exista la lógica, basta con agregar `.setInteractive()` + el handler.
  private mobileFeatureStub(
    x: number,
    y: number,
    w: number,
    h: number,
    [title, sub]: [string, string],
    [colorTop, colorBottom]: [string, string],
    // CORRECCIÓN 3 (punto 2): "price" = texto de precio (COMPRAR FUNCIÓN);
    // "toggle" = estado ON/OFF en una píldora con punto de color (DOBLAR
    // POSIBILIDAD) — son dos tipos de contenido distintos, se ven distinto.
    kind: "price" | "toggle" = "price"
  ) {
    const r = h * 0.4;
    const top = hexToNum(colorTop, 0x1fae6b);
    const bottom = hexToNum(colorBottom, 0x0c6b3f);
    // Antes quedaba a 55% de alpha para leerse "deshabilitado" — pero son
    // botones STUB, no deshabilitados de verdad (todavía no hay backend para
    // ellos, pero visualmente deben verse tan activos/vivos como cualquier
    // otro). Opacidad completa.
    const cont = this.add.container(x, y).setDepth(7);

    // Sombra inferior (un poco más de difusión: dos capas en vez de una sola,
    // para que no se vea un borde duro — Fase 7, punto 4).
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.18).fillRoundedRect(-w / 2 - 2, -h / 2 + h * 0.1, w + 4, h, r);
    shadow.fillStyle(0x000000, 0.3).fillRoundedRect(-w / 2, -h / 2 + h * 0.07, w, h, r);
    // Halo exterior del color del botón (le da "peso" de luz propia, como los
    // botones con glow de la referencia, en vez de quedar plano sobre el fondo).
    const halo = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.35);
    halo.fillStyle(top, 0.5).fillRoundedRect(-w / 2 - 6, -h / 2 - 6, w + 12, h + 12, r + 6);
    // Relleno en degradado (glossy) de 3 paradas en vez de 2: sube a un tono
    // más claro ANTES de caer al oscuro, que es lo que da el aspecto de
    // "caramelo" en vez de un degradado plano de libro de texto.
    const mid = this.lerpColor(top, 0xffffff, 0.18);
    const body = this.add.graphics();
    body.fillGradientStyle(top, top, bottom, bottom, 1).fillRoundedRect(-w / 2, -h / 2, w, h, r);
    body.fillStyle(mid, 0.5).fillRoundedRect(-w / 2 + 3, -h / 2 + 3, w - 6, h * 0.42, r * 0.75);
    body.lineStyle(2.5, 0xffffff, 0.6).strokeRoundedRect(-w / 2, -h / 2, w, h, r);
    // Highlight superior (brillo de cristal), más concentrado hacia arriba.
    const highlight = this.add.graphics();
    highlight.fillStyle(0xffffff, 0.3).fillRoundedRect(-w / 2 + 5, -h / 2 + 3, w - 10, h * 0.3, r * 0.7);
    highlight.fillStyle(0xffffff, 0.12).fillRoundedRect(-w / 2 + 4, -h / 2 + h * 0.3, w - 8, h * 0.2, r * 0.6);

    // CORRECCIÓN 3 (punto 2): texto más grande, BLANCO con contorno sólido
    // (antes el contorno era semitransparente "#00000080" — se veía débil).
    const titleTxt = this.add
      .text(0, -h * 0.18, title, {
        fontFamily: MOBILE_FONT,
        fontSize: `${Math.round(h * 0.3)}px`,
        fontStyle: "800",
        color: "#ffffff",
        align: "center",
        wordWrap: { width: w * 0.92 },
      })
      .setOrigin(0.5)
      .setStroke("#000000", 4)
      .setShadow(0, 2, "#000000", 4, true, true);

    let sublayer: Phaser.GameObjects.GameObject[];
    if (kind === "toggle") {
      // Píldora de estado ON/OFF (en vez de texto suelto): fondo oscuro +
      // punto de color + la palabra — se lee como un control real, no como
      // una segunda línea de texto perdida.
      const on = sub.trim().toUpperCase() === "ON";
      const pillW = w * 0.4, pillH = h * 0.3;
      const pillY = h * 0.22;
      const pill = this.add.graphics();
      pill.fillStyle(0x000000, 0.4).fillRoundedRect(-pillW / 2, pillY - pillH / 2, pillW, pillH, pillH / 2);
      pill.lineStyle(2, on ? 0x7CFF9E : 0xffffff, on ? 0.9 : 0.55).strokeRoundedRect(-pillW / 2, pillY - pillH / 2, pillW, pillH, pillH / 2);
      const dot = this.add.graphics();
      dot.fillStyle(on ? 0x4dff7a : 0xff6b6b, 1).fillCircle(-pillW / 2 + pillH * 0.5, pillY, pillH * 0.28);
      const stateTxt = this.add
        .text(pillH * 0.3, pillY, sub.toUpperCase(), {
          fontFamily: MOBILE_FONT,
          fontSize: `${Math.round(h * 0.2)}px`,
          fontStyle: "800",
          color: on ? "#baffce" : "#ffe3e3",
        })
        .setOrigin(0, 0.5);
      sublayer = [pill, dot, stateTxt];
    } else {
      const subTxt = this.add
        .text(0, h * 0.27, sub, {
          fontFamily: MOBILE_FONT,
          fontSize: `${Math.round(h * 0.23)}px`,
          fontStyle: "800",
          color: "#fff6c8",
        })
        .setOrigin(0.5)
        .setStroke("#000000", 3);
      sublayer = [subTxt];
    }

    cont.add([shadow, halo, body, highlight, titleTxt, ...sublayer]);
    return cont;
  }




  private toggleTurbo() {
    this.turbo = !this.turbo;
    this.registry.set("turbo", this.turbo);
    this.turboToggle?.setActive(this.turbo);
    sfx.reelStop();
  }

  private toggleAuto() {
    // Durante las tiradas gratis, AUTO pausa/reanuda el encadenado automático (el
    // jugador pidió poder detenerlo y tirarlas a mano).
    if (this.freeSpinsRemaining > 0) {
      this.freePaused = !this.freePaused;
      this.autoToggle?.setActive(!this.freePaused);
      this.autoTimer?.remove(false); // cancela la tirada gratis ya programada
      this.autoTimer = undefined;
      if (!this.freePaused && !this.busy) this.onSpin(); // reanudar: sigue solo
      sfx.reelStop();
      return;
    }
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
    // CORRECCIÓN 4 (punto 0) + FASE 3 (punto 3): la apuesta vive en una
    // pastilla con pulso de ESCALA en móvil Y en escritorio real. El fallback
    // de ventana angosta no táctil sigue con el `setText` directo de siempre.
    this.betValue.setText(this.money(this.bet));
    // REORGANIZACIÓN móvil: eco de solo lectura en la fila de estadísticas
    // del fondo (ver buildControlsMobile) — `undefined` en cualquier otro
    // modo, así que esto es inerte ahí.
    this.betValueEcho?.setText(this.money(this.bet));
    if (this.isMobile || !this.portrait) this.betPill?.pulse();
    sfx.reelStop();
  }

  private setupMusic() {
    if (this.cache.audio.exists(TEX.musicTrack)) {
      this.music = this.sound.add(TEX.musicTrack, { loop: true, volume: 0.35 });
    }
    // El botón de SONIDO lo dibuja el HUD de cada diseño (buildControlsMobile /
    // DesktopHud), siempre — ver musicToggleMobile / musicToggleDesktop.
  }

  private tryStartMusic() {
    if (this.music && !this.musicMuted && !this.music.isPlaying) this.music.play();
  }

  // Clave de localStorage para recordar la preferencia de sonido (Fase 6
  // móvil + FASE 4 DESKTOP, punto 6 — se LEE/ESCRIBE en cualquier modo NO
  // móvil también, ver create()/toggleMusic()).
  private static readonly MUSIC_PREF_KEY = "slot_music_muted";

  private toggleMusic() {
    this.musicMuted = !this.musicMuted;
    this.registry.set("musicMuted", this.musicMuted);
    // Se persiste en cualquier modo (antes solo móvil) — ver nota de
    // MUSIC_PREF_KEY arriba.
    try {
      localStorage.setItem(SlotScene.MUSIC_PREF_KEY, this.musicMuted ? "1" : "0");
    } catch {
      /* localStorage bloqueado: se ignora, no es crítico */
    }
    if (this.musicMuted) this.music?.pause();
    else if (this.music) (this.music.isPaused ? this.music.resume() : this.music.play());
    this.musicToggleMobile?.setActive(!this.musicMuted);
    this.musicToggleDesktop?.setActive(!this.musicMuted);
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
    if (this.hud) {
      // Horizontal: giro y −/+ deshabilitados, brillo apagado, icono rotando.
      this.hud.setBusy(!enabled);
      return;
    }
    this.button.setAlpha(enabled ? 1 : 0.45);
    this.buttonLabel.setAlpha(enabled ? 1 : 0.45);
    // SOLO MÓVIL (Fase 6, regla 1) + FASE 3 DESKTOP: "estado deshabilitado
    // visible mientras gira" — el disco se atenúa y el icono queda rotando en
    // bucle mientras el botón está deshabilitado (en vez de quedarse quieto y
    // apagado sin más). El fallback de ventana angosta no táctil no usa
    // `this.spinChip` (sigue con el botón de imagen/círculo de siempre), así
    // que esto no le afecta aunque la condición sea más amplia.
    if (this.isMobile || !this.portrait) {
      this.spinChip?.setAlpha(enabled ? 1 : 0.6);
      this.spinningIndicatorTween?.remove();
      this.spinningIndicatorTween = enabled
        ? undefined
        : this.tweens.add({
            targets: this.buttonLabel,
            angle: this.buttonLabel.angle + 360,
            duration: 900,
            repeat: -1,
            ease: "Linear",
          });
    }
    if (enabled) this.button.setInteractive({ useHandCursor: true });
    else this.button.disableInteractive();
  }

  private clearTransient() {
    this.winGfx.clear();
    this.winText?.setText("");
    this.prizeBannerImg?.setVisible(false);
    this.winGroup?.setVisible(true);
    this.hud?.hideWinBanner();
    // Phaser NO quita los tweens de un objeto al destruirlo: un tween infinito
    // (p. ej. el bamboleo del título del BIG WIN) seguía vivo sobre un objeto
    // muerto tras cada premio. Se quitan antes de destruir (incluidos los hijos).
    this.transient.forEach((o) => {
      this.removeTweensDeep(o);
      o.destroy();
    });
    this.transient = [];
    this.winCycleTimer?.remove(false);
    this.winCycleTimer = undefined;
    this.winPulseStops.forEach((stop) => stop());
    this.winPulseStops = [];
    this.reels.forEach((r) => r.setAnticipation(false));
    this.hideMascot(true);
  }

  private removeTweensDeep(o: Phaser.GameObjects.GameObject) {
    removeTweensOf(this, o);
    if (o instanceof Phaser.GameObjects.Container) o.list.forEach((c) => this.removeTweensDeep(c));
  }

  private column(matrix: string[][], c: number): string[] {
    return matrix.map((row) => row[c]);
  }

  private randomColumn(): string[] {
    const pool = this.symbolPool();
    return Array.from({ length: this.rows }, () => Phaser.Utils.Array.GetRandom(pool));
  }

  private async onSpin() {
    if (this.busy || this.winOverlayActive) return;
    this.busy = true;
    this.idleTimer?.remove(false);
    this.clearTransient();
    this.setButtonEnabled(false);
    sfx.unlock();
    sfx.spin();
    this.tryStartMusic();
    this.pulse?.pause();
    if (this.isMobile || !this.portrait) this.spinIdlePulse?.pause();
    // Durante tiradas gratis, GANANCIA es el TOTAL acumulado de la ronda — no
    // se reinicia a $0 en cada tiro (pedido explícito: "no acumula las
    // ganancias a medida que voy jugando"). Fuera de una ronda gratis, sigue
    // reiniciando como siempre (GANANCIA = solo el premio del último tiro).
    if (this.freeSpinsRemaining <= 0) this.winValue.setText(this.money(0));
    // SOLO MÓVIL (Fase 4, regla 4): el carrete necesita saber si va en turbo
    // ANTES de arrancar (afecta su velocidad crucero). Desktop ignora setTurbo.
    this.reels.forEach((r) => {
      r.setTurbo(this.turbo);
      r.startSpin();
    });

    try {
      const resp = await this.runtime.spin(this.bet);

      const validMatrix =
        Array.isArray(resp.matrix) &&
        resp.matrix.length === this.rows &&
        resp.matrix.every((row) => row.length === this.cols);

      // SOLO MÓVIL (Fase 4, regla 3/4): paradas escalonadas 200–260ms (o casi
      // simultáneas en turbo), con sus propios tiempos en CONFIG_MOBILE.
      // Escritorio conserva sus números fijos de siempre.
      const mobileReel = CONFIG_MOBILE.reel;
      const stagger = this.isMobile
        ? this.turbo ? mobileReel.turboStaggerMs : mobileReel.staggerMs
        : this.turbo ? 55 : 180;
      const dur = this.isMobile
        ? this.turbo ? mobileReel.turboStopDurationMs : mobileReel.stopDurationMs
        : this.turbo ? 260 : 650;
      const anticipateFrom = validMatrix ? this.anticipationBoundary(resp.matrix) : this.cols;
      const isAnticipating = anticipateFrom < this.cols;
      if (isAnticipating) sfx.anticipation();
      // SOLO MÓVIL (Fase 4, regla 5): brillo alrededor del panel + vibración
      // leve de cámara mientras dura la anticipación del último rodillo.
      let stopPanelGlow: (() => void) | undefined;
      if (isAnticipating && this.isMobile) {
        stopPanelGlow = this.startMobileAnticipationFx();
      }
      await Promise.all(
        this.reels.map((reel, c) => {
          const target = validMatrix ? this.column(resp.matrix, c) : this.randomColumn();
          const anticipating = c >= anticipateFrom;
          if (anticipating) reel.setAnticipation(true);
          const extra = anticipating ? 420 : 0;
          return reel.stop(target, c * stagger, dur + extra).then(() => {
            reel.setAnticipation(false);
            sfx.reelStop();
          });
        })
      );
      stopPanelGlow?.();

      // SOLO MÓVIL: línea legal diminuta con el ID de la última ronda (no toca
      // nada de la lógica de la tirada, solo lee el dato que ya trae `resp`).
      if (this.isMobile && resp.spin_id) {
        this.legalText?.setText(`RONDA ${resp.spin_id.slice(0, 8).toUpperCase()}`);
      }

      if (typeof resp.balance === "number") {
        // CORRECCIÓN 4 (punto 0): en móvil, el crédito hace count-up DESDE el
        // saldo anterior (no desde $0 cada vez) + un pulso leve de la
        // pastilla. FASE 3 (punto 3): escritorio real adopta lo mismo (CRÉDITO
        // ya es una pastilla ahí también — ver buildControlsDesktop). El
        // fallback de ventana angosta no táctil conserva el `setText`
        // instantáneo de siempre.
        if (this.isMobile || !this.portrait) {
          this.rollUpText(this.balanceValue, "", resp.balance, this.turbo ? 300 : 650, this.balance);
          this.creditPill?.pulse();
        } else {
          this.balanceValue.setText(this.money(resp.balance));
        }
        this.balance = resp.balance;
        this.registry.set("balance", this.balance);
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
      if (this.isMobile || !this.portrait) this.spinIdlePulse?.resume();
      this.maybeAutoNext();
      this.resetIdleTimer();
      // Un resize que llegó durante el giro se aplica ahora (ver onDesktopResize).
      if (this.pendingRelayout) this.onResize(this.scale.gameSize);
    }
  }

  // SOLO MÓVIL (Fase 4, regla 5): brillo pulsante alrededor del PANEL completo
  // (no solo el carrete, que ya tiene su propio aro — ver Reel.setAnticipation)
  // + una vibración leve de cámara, mientras dura la anticipación. Devuelve la
  // función para apagarlo cuando el último rodillo frena.
  private startMobileAnticipationFx(): () => void {
    sfx.scatterLand(); // Fase 6: hook de audio del scatter que dispara la anticipación
    const pad = this.panelPad;
    const r = Math.round(this.size * 0.22);
    const px = this.gridX - pad;
    const py = this.gridY - pad;
    const pw = this.gridW + pad * 2;
    const ph = this.gridH + pad * 2;
    const cfg = CONFIG_MOBILE.reel;

    const glow = this.add
      .graphics()
      .setDepth(CONFIG_MOBILE.depth.effects)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.25);
    glow.lineStyle(Math.max(6, Math.round(this.size * 0.08)), this.accent, 1);
    glow.strokeRoundedRect(px, py, pw, ph, r);

    const tween = this.tweens.add({
      targets: glow,
      alpha: cfg.anticipationGlowAlpha,
      duration: 320,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
    this.cameras.main.shake(cfg.anticipationShakeMs, cfg.anticipationShakeIntensity);

    return () => {
      tween.remove();
      glow.destroy();
    };
  }

  // Columna a partir de la cual conviene mostrar "anticipación" (aro dorado
  // pulsante + tensión sonora): cuando ya hay ≥2 columnas con scatter entre las
  // primeras y quedan carretes por resolver, así el jugador siente que el
  // feature "puede caer" antes de ver el resultado final. Heurística genérica
  // (no depende de cuántos scatters exige cada casino para el trigger).
  private anticipationBoundary(matrix: string[][]): number {
    const scatters = new Set(
      (this.runtime.theme?.symbols ?? []).filter((s) => s.is_scatter).map((s) => s.code)
    );
    if (!scatters.size || this.cols < 3) return this.cols;
    const trailing = Math.min(2, this.cols - 1);
    const boundary = this.cols - trailing;
    let earlyCols = 0;
    for (let c = 0; c < boundary; c++) {
      for (let r = 0; r < this.rows; r++) {
        if (scatters.has(matrix[r]?.[c])) {
          earlyCols++;
          break;
        }
      }
    }
    return earlyCols >= 2 ? boundary : this.cols;
  }

  // Procesa el estado de tiradas gratis de la respuesta: dispara el aviso, actualiza
  // el contador y activa/desactiva la ronda.
  private updateFreeSpins(resp: SpinResponse) {
    if ((resp.scatter_count ?? 0) > 0) this.highlightScatters(resp.matrix);
    const wasActive = this.freeSpinsRemaining > 0;
    const remaining = resp.free_spins_remaining ?? 0;
    const justTriggered = !!resp.free_spins_triggered && !resp.in_free_spins;
    this.freeSpinsRemaining = remaining;
    this.freeMultiplier = resp.win_multiplier && resp.win_multiplier > 1 ? resp.win_multiplier : 1;

    if (justTriggered) {
      // Un tiro PAGADO abrió la ronda: aviso grande.
      this.freeMultiplier = 1; // el multiplicador aplica en las tiradas libres siguientes
      this.freeSpinsTotalWin = 0;
      this.announceFreeSpins(resp.free_spins_awarded ?? remaining);
    }
    if (resp.in_free_spins) this.freeSpinsTotalWin += resp.total_win;

    // El botón AUTO refleja el encadenado de tiradas gratis: activo mientras corren (salvo
    // que estén pausadas). Al terminar la ronda, resetea la pausa y vuelve a mostrar el
    // estado del autoplay real.
    if (remaining > 0) {
      this.autoToggle?.setActive(!this.freePaused);
    } else if (wasActive) {
      this.freePaused = false;
      this.autoToggle?.setActive(this.autoOn);
      this.announceFreeSpinsSummary(this.freeSpinsTotalWin);
      this.freeSpinsTotalWin = 0;
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
    sfx.freeSpinsIntro();
    this.cameras.main.flash(280, 255, 255, 255, false);
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
    this.crisp(t1, t2);
    cont.add([t1, t2]);
    this.transient.push(overlay, cont);
    this.tweens.add({ targets: cont, scale: 1, duration: 500, ease: "Back.easeOut" });
    this.time.delayedCall(1600, () => {
      this.tweens.add({ targets: [overlay, cont], alpha: 0, duration: 350, onComplete: () => { overlay.destroy(); cont.destroy(); } });
    });
  }

  // Resumen al terminar la ronda: la ganancia TOTAL acumulada en las tiradas gratis,
  // con roll-up, antes de volver al juego base.
  private announceFreeSpinsSummary(total: number) {
    if (total <= 0) return;
    sfx.freeSpinsOutro();
    const cx = this.W / 2;
    const cy = this.gridY + this.gridH / 2;
    const overlay = this.add.rectangle(0, 0, this.W, this.H, 0x000000, 0.6).setOrigin(0).setDepth(20);
    const cont = this.add.container(cx, cy).setDepth(30).setScale(0);
    const t1 = this.add.text(0, -50, "TOTAL TIRADAS GRATIS", {
      fontFamily: "Arial, sans-serif", fontSize: `${Math.round(Math.min(this.W * 0.06, 40))}px`,
      fontStyle: "bold", color: "#ffffff", stroke: "#000000", strokeThickness: 6,
    }).setOrigin(0.5);
    const amount = this.add.text(0, 20, this.money(0), {
      fontFamily: "Arial, sans-serif", fontSize: `${Math.round(Math.min(this.W * 0.12, 72))}px`,
      fontStyle: "bold", color: this.accentHex, stroke: "#000000", strokeThickness: 8,
    }).setOrigin(0.5);
    this.crisp(t1, amount);
    cont.add([t1, amount]);
    this.transient.push(overlay, cont);
    this.tweens.add({ targets: cont, scale: 1, duration: 500, ease: "Back.easeOut" });
    this.rollUpText(amount, "", total, 1300);
    this.time.delayedCall(2700, () => {
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
      const y = this.L ? this.L.fsBadge.cy : this.gridY - this.panelPad - 6;
      const bg = this.add.graphics();
      this.fsBadgeText = this.add.text(0, 0, label, {
        fontFamily: "Arial, sans-serif", fontSize: `${Math.round(Math.min(this.W * 0.026, 20))}px`,
        fontStyle: "bold", color: "#ffffff", stroke: "#000000", strokeThickness: 4,
      }).setOrigin(0.5);
      this.crisp(this.fsBadgeText);
      const w = this.fsBadgeText.width + 28;
      const h = this.fsBadgeText.height + 12;
      this.fsBadgeW = w;
      bg.fillStyle(this.accent, 0.95).fillRoundedRect(-w / 2, -h / 2, w, h, 10);
      const x = this.L ? this.L.fsBadge.right - w / 2 : this.W - w / 2 - 20;
      this.fsBadge = this.add.container(x, y, [bg, this.fsBadgeText]).setDepth(12);
    } else {
      this.fsBadgeText!.setText(label);
      this.fsBadge!.setScale(1.18);
      this.tweens.add({ targets: this.fsBadge, scale: 1, duration: 220, ease: "Back.easeOut" });
    }
  }

  // Tween numérico que va escribiendo "prefix + monto" (roll-up de ganancia),
  // con un tick sonoro periódico mientras sube. `from` permite animar un DELTA
  // (p. ej. el crédito). Horizontal: escrituras con THROTTLE (~30/s) sobre
  // BitmapText; móvil: igual que siempre (una escritura por frame).
  private rollUpText(text: TextLike, prefix: string, to: number, duration: number, from = 0) {
    if (to === from) {
      text.setText(prefix + this.money(to));
      return;
    }
    let lastTick = from;
    const step = Math.max(1, Math.abs(to - from) / 14);
    const minInterval = this.isMobile ? 0 : CONFIG_DESKTOP.text.rollUpIntervalMs;
    let lastWrite = -Infinity;
    this.tweens.addCounter({
      from,
      to,
      duration,
      ease: "Cubic.easeOut",
      onUpdate: (tw) => {
        const v = tw.getValue() ?? from;
        if (minInterval === 0 || this.time.now - lastWrite >= minInterval) {
          text.setText(prefix + this.money(Math.round(v)));
          lastWrite = this.time.now;
        }
        if (Math.abs(v - lastTick) >= step && v !== to) {
          sfx.tick();
          lastTick = v;
        }
      },
      onComplete: minInterval ? () => text.setText(prefix + this.money(to)) : undefined,
    });
  }

  // Encadena el siguiente giro automático (autoplay) o la siguiente TIRADA GRATIS.
  private maybeAutoNext() {
    // Ronda de tiradas gratis: encadena sola hasta agotarse (no consume saldo), salvo
    // que el jugador la haya PAUSADO con AUTO. El temporizador se guarda para poder
    // cancelarlo al pausar.
    if (this.freeSpinsRemaining > 0) {
      if (this.freePaused) return;
      this.autoTimer = this.time.delayedCall(this.turbo ? 260 : 900, () => {
        if (!this.busy && this.freeSpinsRemaining > 0 && !this.freePaused) this.onSpin();
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
    // Durante tiradas gratis, GANANCIA muestra el TOTAL acumulado de la ronda,
    // no solo el premio de este tiro — `freeSpinsTotalWin` recién se actualiza
    // en updateFreeSpins() (que corre DESPUÉS de present(), ver onSpin), así
    // que acá se suma a mano el premio de ESTE tiro sobre lo acumulado hasta
    // el tiro anterior. El umbral de BIG WIN/etc. (`mult`, abajo) sigue
    // midiendo SOLO este tiro, no el acumulado — un tiro chico no debe
    // disparar la celebración grande solo porque la ronda ya lleva mucho.
    const displayWin = resp.in_free_spins ? this.freeSpinsTotalWin + resp.total_win : resp.total_win;
    this.winValue.setText(this.money(displayWin));
    const mult = this.bet > 0 ? resp.total_win / this.bet : 0;
    // Fase 5: presentación de ganancias propia para móvil (umbrales y
    // celebración en CONFIG_MOBILE). Escritorio sigue exactamente abajo, sin
    // tocar — el cálculo/acreditación del premio es el mismo para ambos, ya
    // hecho arriba (`resp.total_win` ya viene acreditado del backend).
    if (this.isMobile) {
      this.presentMobile(resp, mult);
      return;
    }
    let tier: WinTier | null = null;
    if (resp.jackpot_triggered) tier = "jackpot";
    else if (mult >= WIN_TIERS.epic) tier = "epic";
    else if (mult >= WIN_TIERS.mega) tier = "mega";
    else if (mult >= WIN_TIERS.big) tier = "big";
    if (tier) {
      // Premio grande en AUTOPLAY (con o sin turbo): se detiene para que el jugador
      // vea la celebración con calma en vez de que la tape el siguiente giro.
      if (this.autoOn) this.stopAuto();
      this.bigWinDesktop(resp, tier);
    } else {
      this.normalWin(resp);
    }
  }

  // ====================================================================== //
  // FASE 5 (SOLO MÓVIL) — presentación de ganancias. No cambia en nada cómo //
  // se calcula/acredita el premio (eso ya pasó antes de llamar a present())://
  // solo cómo se anima y se muestra. Escritorio sigue usando present()/     //
  // highlightWins()/normalWin()/bigWin()/celebrateBigWin() de arriba.       //
  // ====================================================================== //
  private presentMobile(resp: SpinResponse, mult: number) {
    const tiers = CONFIG_MOBILE.celebration.tiers;
    let tier: keyof typeof tiers | null = null;
    if (resp.jackpot_triggered) tier = "jackpot";
    else if (mult >= CONFIG_MOBILE.winTiers.super) tier = "super";
    else if (mult >= CONFIG_MOBILE.winTiers.mega) tier = "mega";
    else if (mult >= CONFIG_MOBILE.winTiers.big) tier = "big";
    if (tier) {
      if (this.autoOn) this.stopAuto();
      this.bigWinMobile(resp, tier);
    } else {
      this.normalWinMobile(resp);
    }
  }

  // Vibración háptica corta (regla 4): solo si el navegador la soporta. Nunca
  // lanza si falla (algunos navegadores la bloquean sin permiso del usuario).
  private hapticBuzz(pattern: number | readonly number[]) {
    try {
      navigator.vibrate?.(Array.isArray(pattern) ? [...pattern] : (pattern as number));
    } catch {
      /* sin soporte o bloqueado: no es crítico, se ignora */
    }
  }

  // Monedas chicas en un punto dado (p. ej. la franja GANANCIA en un premio
  // normal) — mismo mecanismo que la lluvia de monedas del Big Win, pero sutil.
  private mobileCoinBurst(x: number, y: number, count: number) {
    const coins = this.add
      .particles(0, 0, TEX.coin, {
        lifespan: 900,
        speed: { min: 80, max: 220 },
        angle: { min: 250, max: 290 },
        gravityY: 700,
        scale: { start: 0.5, end: 0.1 },
        rotate: { min: 0, max: 360 },
        tint: [this.accent, 0xffe066],
        emitting: false,
      })
      .setDepth(8);
    coins.explode(count, x, y);
    this.transient.push(coins);
  }

  // Como highlightWins(), pero además (regla 1): atenúa a ~35% TODOS los
  // símbolos que NO ganaron, y agrega un goteo sutil de partículas sobre cada
  // símbolo ganador. Los "apagadores" de la atenuación se registran en
  // `winPulseStops` (el mismo mecanismo que ya limpia clearTransient()), así
  // no hace falta un arreglo nuevo para no dejar nada colgado (regla 5).
  private highlightWinsMobile(resp: SpinResponse) {
    const wilds = new Set(
      (this.runtime.theme?.symbols ?? []).filter((s) => s.is_wild).map((s) => s.code)
    );
    wilds.add("WILD");
    const winningKeys = new Set<string>();
    const pulse = (c: number, r: number) => {
      const key = `${c}:${r}`;
      if (winningKeys.has(key)) return;
      winningKeys.add(key);
      // Color de ESE símbolo (winColorFor, misma paleta que usa la línea que
      // conecta las celdas — ver cycleWinLines) — así el resplandor/estela de
      // cada celda combina con la raya de su propia combinación.
      const color = this.winColorFor(resp.matrix[r]?.[c] ?? "");
      this.winPulseStops.push(this.reels[c].pulseCell(r, color));
      this.mobileWinSparkle(c, r);
    };
    for (const win of resp.winning_lines) {
      if (win.kind === "LINE" && win.line_index != null) {
        this.paylines[win.line_index]?.forEach((row, c) => pulse(c, row));
      } else if (win.kind === "WAY") {
        for (let c = 0; c < Math.min(win.count, this.cols); c++) {
          for (let r = 0; r < this.rows; r++) {
            const s = resp.matrix[r]?.[c];
            if (s === win.symbol || wilds.has(s)) pulse(c, r);
          }
        }
      }
    }
    for (let c = 0; c < this.cols; c++) {
      for (let r = 0; r < this.rows; r++) {
        if (winningKeys.has(`${c}:${r}`)) continue;
        this.reels[c].setCellAlpha(r, CONFIG_MOBILE.celebration.dimOpacity);
        const reel = this.reels[c];
        this.winPulseStops.push(() => reel.setCellAlpha(r, 1));
      }
    }
    this.cycleWinLines(resp);
  }

  // Goteo sutil de partículas sobre una celda ganadora, mientras dure el pulso
  // de esa celda (se apaga junto con `pulseCell`, vía `winPulseStops`).
  private mobileWinSparkle(c: number, r: number) {
    const p = this.reels[c].cellCenter(r);
    const spark = this.add
      .particles(0, 0, TEX.sparkle, {
        x: p.x,
        y: p.y,
        lifespan: 500,
        speed: { min: 20, max: 60 },
        scale: { start: 0.5, end: 0 },
        alpha: { start: 0.9, end: 0 },
        quantity: 1,
        frequency: CONFIG_MOBILE.celebration.sparkleFreqMs,
        tint: this.accent,
        blendMode: Phaser.BlendModes.ADD,
      })
      .setDepth(6);
    // Fase 7 (auditoría): NO se registra también en `winPulseStops` con
    // `spark.stop()` — `clearTransient()` destruye `transient` ANTES de correr
    // los `winPulseStops`, así que ese `.stop()` llegaría a apuntar a un
    // emisor ya destruido (podía lanzar y cortar a mitad el resto de la
    // limpieza, dejando símbolos pegados al 35% de opacidad). `transient`
    // solo con destroy() alcanza: el emisor desaparece igual, en la misma
    // pasada de limpieza.
    this.transient.push(spark);
  }

  private normalWinMobile(resp: SpinResponse) {
    sfx.win();
    this.winGroup.setVisible(false);
    this.highlightWinsMobile(resp);
    this.hapticBuzz(CONFIG_MOBILE.haptics.normalWin);

    // Contador de ganancia con count-up + monedas sutiles (regla 2).
    const total = resp.total_win;
    const prefix = "GANASTE  ";
    this.winText!.setText(prefix + this.money(total)).setScale(1);
    const baseW = this.winText!.width;
    const baseH = this.winText!.height;
    const fit = Math.min(1, this.winMaxW / Math.max(1, baseW));

    if (this.prizeBannerImg) {
      this.prizeBannerImg.setPosition(this.W / 2, this.bannerY).setVisible(true).setScale(1);
      this.fitImage(this.prizeBannerImg, baseW * fit * 1.5 + 40, baseH * fit * 2.6);
    }

    this.winText!.setText(prefix + this.money(0));
    this.winText!.setScale(fit * 0.6);
    this.tweens.add({ targets: this.winText!, scale: fit, duration: 350, ease: "Back.easeOut" });
    this.rollUpText(this.winText!, prefix, total, this.turbo ? 320 : 750);
    this.mobileCoinBurst(this.W / 2, this.winRowY, CONFIG_MOBILE.celebration.coinBurstSmall);
  }

  private bigWinMobile(resp: SpinResponse, tier: keyof typeof CONFIG_MOBILE.celebration.tiers) {
    sfx.winTier(tier); // Fase 6: ganancia "escalada por tamaño" (acorde más lleno cuanto más grande)
    this.winGroup.setVisible(false);
    this.highlightWinsMobile(resp);
    this.hapticBuzz(CONFIG_MOBILE.haptics.bigWin[tier]);
    const highlightMs = this.turbo ? 250 : 900;
    this.time.delayedCall(highlightMs, () => this.celebrateBigWinMobile(resp, tier));
  }

  private celebrateBigWinMobile(resp: SpinResponse, tier: keyof typeof CONFIG_MOBILE.celebration.tiers) {
    const cfg = CONFIG_MOBILE.celebration.tiers[tier];
    this.cameras.main.shake(cfg.shakeMs, cfg.shakeI);

    const hasMascot = !!this.mascotFrames || !!this.mascotStaticKey;
    if (hasMascot) this.showMascot(cfg.holdMs + 400);

    const cx = this.W / 2;
    const cy = this.gridY + this.gridH / 2;

    // SOLO MÓVIL: se puede saltar la celebración tocando la pantalla (regla 3)
    // — el `overlay` ya cubre toda la pantalla, así que es la zona táctil.
    const overlay = this.add
      .rectangle(0, 0, this.W, this.H, 0x000000, 0.72)
      .setOrigin(0)
      .setDepth(20)
      .setInteractive();
    this.transient.push(overlay);

    // Rayos de luz girando detrás del banner (regla 3).
    const rayColor = hexToNum(cfg.color, 0xffd23f);
    // Dibujados en coordenadas LOCALES (0,0) y luego posicionados con
    // setPosition: así `angle` (tweened abajo) rota alrededor del centro
    // correcto. Dibujar ya en (cx,cy) Y además reposicionar duplicaría el
    // desplazamiento.
    const rays = this.add.graphics().setDepth(21).setBlendMode(Phaser.BlendModes.ADD);
    const rayCount = 10;
    const rayLen = Math.max(this.W, this.H) * 0.9;
    for (let i = 0; i < rayCount; i++) {
      const a = (i / rayCount) * Math.PI * 2;
      const spread = Math.PI / rayCount / 2.2;
      rays.fillStyle(rayColor, 0.14);
      rays.beginPath();
      rays.moveTo(0, 0);
      rays.arc(0, 0, rayLen, a - spread, a + spread, false);
      rays.closePath();
      rays.fillPath();
    }
    rays.setPosition(cx, cy);
    const raysTween = this.tweens.add({ targets: rays, angle: 360, duration: 9000, repeat: -1, ease: "Linear" });
    this.transient.push(rays);

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
    coins.explode(cfg.coins, cx, cy - 40);
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
    confetti.explode(cfg.confetti, cx, cy - 60);
    this.transient.push(confetti);

    // Texto gigante con degradado dorado/propio del nivel + contorno (regla 3).
    const banner = this.add.container(cx, cy).setDepth(30);
    const titleText = this.goldGradientText(
      0,
      -50,
      cfg.title,
      Math.round(Math.min(this.W * 0.16, 170)),
      "#2b1604",
      cfg.gradient
    );
    const amountText = this.goldGradientText(
      0,
      70,
      this.money(0),
      Math.round(Math.min(this.W * 0.11, 120)),
      "#2b1604",
      cfg.gradient
    );
    banner.add([titleText, amountText]);
    banner.setScale(0);
    this.transient.push(banner);

    this.tweens.add({ targets: banner, scale: 1, duration: 550, ease: "Back.easeOut" });
    this.tweens.add({ targets: titleText, angle: { from: -4, to: 4 }, duration: 500, yoyo: true, repeat: -1 });
    this.rollUpText(amountText, "", resp.total_win, cfg.rollMs);

    // Saltar tocando la pantalla, o se cierra sola a los `holdMs` de siempre.
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      dismissTimer.remove(false);
      raysTween.remove();
      this.tweens.add({
        targets: [overlay, banner, rays],
        alpha: 0,
        duration: 300,
        onComplete: () => this.clearTransient(),
      });
    };
    overlay.once("pointerdown", finish);
    const dismissTimer = this.time.delayedCall(cfg.holdMs, finish);
  }

  // Todos los símbolos ganadores (de todas las líneas/ways) pulsan juntos con
  // glow, mientras las líneas se resaltan UNA POR UNA debajo (más legible que
  // pintarlas todas encima). Compartido entre premios normales y big wins: una
  // big win también debe mostrar qué figuras/combinaciones la generaron.
  private highlightWins(resp: SpinResponse) {
    const wilds = new Set(
      (this.runtime.theme?.symbols ?? []).filter((s) => s.is_wild).map((s) => s.code)
    );
    wilds.add("WILD");
    const pulsed = new Set<string>();
    const pulse = (c: number, r: number) => {
      const key = `${c}:${r}`;
      if (pulsed.has(key)) return;
      pulsed.add(key);
      this.winPulseStops.push(this.reels[c].pulseCell(r));
    };
    for (const win of resp.winning_lines) {
      if (win.kind === "LINE" && win.line_index != null) {
        this.paylines[win.line_index]?.forEach((row, c) => pulse(c, row));
      } else if (win.kind === "WAY") {
        for (let c = 0; c < Math.min(win.count, this.cols); c++) {
          for (let r = 0; r < this.rows; r++) {
            const s = resp.matrix[r]?.[c];
            if (s === win.symbol || wilds.has(s)) pulse(c, r);
          }
        }
      }
    }
    this.cycleWinLines(resp);
  }


  // Paleta para distinguir combinaciones distintas en la misma tirada: cada
  // símbolo ganador recibe un color estable (mismo símbolo -> mismo color), así
  // varias rayas simultáneas/alternadas no se confunden entre sí.
  private static readonly WIN_COLORS = [0xff3b3b, 0x00e5ff, 0xffd23f, 0x4dff7a, 0xff6bd6, 0xff9f1c];
  private winColorFor(symbol: string): number {
    let hash = 0;
    for (let i = 0; i < symbol.length; i++) hash = (hash * 31 + symbol.charCodeAt(i)) >>> 0;
    return SlotScene.WIN_COLORS[hash % SlotScene.WIN_COLORS.length];
  }

  // Resalta las líneas/ways ganadoras UNA A LA VEZ (si hay varias) para que se
  // puedan leer, en vez de amontonarlas todas de golpe.
  private cycleWinLines(resp: SpinResponse) {
    const wins = resp.winning_lines;
    if (!wins.length) return;
    const stepMs = this.turbo ? 220 : wins.length > 1 ? 700 : 1400;
    let i = 0;
    const showStep = () => {
      this.winGfx.clear();
      const win = wins[i % wins.length];
      const color = this.winColorFor(win.symbol);
      if (win.kind === "LINE" && win.line_index != null) this.drawLineWin(win.line_index, color);
      else if (win.kind === "WAY") this.drawWayWin(resp.matrix, win.symbol, win.count, color);
      i++;
      if (wins.length > 1) this.winCycleTimer = this.time.delayedCall(stepMs, showStep);
    };
    showStep();
  }

  // Traza una raya que conecta, en orden, un conjunto de puntos — ajustada
  // exactamente entre el primer y el último símbolo, sin salirse del rango — y
  // enmarca cada celda ganadora en el mismo color.
  private drawWinPath(points: Array<{ x: number; y: number }>, color: number) {
    if (points.length === 0) return;
    if (points.length === 1) {
      // REORGANIZACIÓN móvil: sin marco por celda (ver más abajo) — el
      // resplandor+estela de pulseCell ya marca el símbolo ganador solo.
      if (!this.isMobile) {
        this.winGfx.lineStyle(8, color, 0.95);
        this.frameCell(points[0].x, points[0].y, color);
      }
      return;
    }
    // REORGANIZACIÓN móvil (pedido explícito): la raya que conecta los
    // símbolos pasa de recta y gruesa a una CURVA suave y delgada ("como un
    // pincelazo") — se aproxima con una Spline de Phaser (pasa por TODOS los
    // puntos, igual que la recta de antes) y se dibuja como una polilínea de
    // muchos segmentos cortos. Escritorio/fallback: SIN TOCAR, recta de
    // siempre.
    if (this.isMobile) {
      const spline = new Phaser.Curves.Spline(points.map((p) => new Phaser.Math.Vector2(p.x, p.y)));
      const curvePoints = spline.getPoints(points.length * 16);
      // Pedido explícito: se veía demasiado fina (3px en coordenadas de
      // diseño móvil, 1080 de ancho) — más gruesa para que se note de verdad.
      this.winGfx.lineStyle(10, color, 0.95);
      this.winGfx.strokePoints(curvePoints, false, false);
      // REORGANIZACIÓN móvil (pedido, captura): el marco cuadrado por celda
      // (frameCell) tapaba la estela nueva de pulseCell (vive DENTRO del
      // reel, a menor depth que winGfx) — se quita acá; la curva + el
      // resplandor/estela de cada símbolo ya marcan la combinación sin él.
      // Escritorio/fallback conservan el marco de siempre (rama `else`).
    } else {
      this.winGfx.lineStyle(8, color, 0.95);
      for (let i = 0; i < points.length - 1; i++) {
        this.winGfx.lineBetween(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);
      }
      points.forEach((p) => this.frameCell(p.x, p.y, color));
    }
  }

  // Resalta una línea de pago (modo LINES): traza la línea y enmarca cada celda.
  // La línea se dibuja más larga que la rejilla: entra desde fuera del riel
  // izquierdo y sale fuera del riel derecho (como en un slot real), siguiendo la
  // misma pendiente del tramo con el que conecta en cada extremo.
  private drawLineWin(lineIndex: number, color: number) {
    const pattern = this.paylines[lineIndex];
    if (!pattern) return;
    const points = pattern.map((row, c) => this.reels[c].cellCenter(row));
    this.drawWinPath(points, color);
  }

  // Resalta una victoria WAYS: traza una raya que recorre, de riel en riel, cada
  // celda donde cayó el símbolo (o WILD) dentro de los primeros `count` carretes
  // — así se ve exactamente qué figuras formaron la combinación, no solo un marco.
  private drawWayWin(matrix: string[][], symbol: string, count: number, color: number) {
    const wilds = new Set(
      (this.runtime.theme?.symbols ?? []).filter((s) => s.is_wild).map((s) => s.code)
    );
    wilds.add("WILD");
    const points: Array<{ x: number; y: number }> = [];
    for (let c = 0; c < Math.min(count, this.cols); c++) {
      for (let r = 0; r < this.rows; r++) {
        const s = matrix[r]?.[c];
        if (s === symbol || wilds.has(s)) points.push(this.reels[c].cellCenter(r));
      }
    }
    this.drawWinPath(points, color);
  }

  private frameCell(x: number, y: number, color: number = this.accent) {
    // En escritorio `this.cellH === this.size` (celda cuadrada): esto no
    // cambia nada ahí. En móvil la celda es 4:5 (más alta que ancha) —
    // usar `this.size` para el alto también (como antes) dibujaba un marco
    // CUADRADO dentro de una celda más alta, que no llegaba a cubrir el
    // símbolo de arriba a abajo — se veía como un recorte cuadrado en vez
    // de encuadrar la figura completa.
    this.winGfx.lineStyle(6, color, 0.95);
    this.winGfx.strokeRoundedRect(
      x - this.size / 2 + 6,
      y - this.cellH / 2 + 6,
      this.size - 12,
      this.cellH - 12,
      16
    );
  }

  // Configuración por nivel: cuanto más grande el premio, más partículas, más
  // shake de cámara y más tiempo de roll-up (más "peso" en la celebración).
  private static readonly TIER_CFG: Record<
    WinTier,
    { title: string; color: string; coins: number; confetti: number; shakeMs: number; shakeI: number; rollMs: number; holdMs: number }
  > = {
    big: { title: "¡BIG WIN!", color: "#ffd23f", coins: 70, confetti: 90, shakeMs: 220, shakeI: 0.006, rollMs: 1300, holdMs: 2400 },
    mega: { title: "¡MEGA WIN!", color: "#ff9f1c", coins: 110, confetti: 140, shakeMs: 320, shakeI: 0.009, rollMs: 1700, holdMs: 2900 },
    epic: { title: "¡EPIC WIN!", color: "#ef476f", coins: 160, confetti: 200, shakeMs: 420, shakeI: 0.013, rollMs: 2100, holdMs: 3400 },
    jackpot: { title: "¡JACKPOT!", color: "#ffd23f", coins: 220, confetti: 260, shakeMs: 550, shakeI: 0.018, rollMs: 2600, holdMs: 4000 },
  };

  // Muestra la mascota del premio grande (si hay) DENTRO del canvas, a esta
  // profundidad fija: por ENCIMA de los rieles/panel (depth ≤12) y por DEBAJO del
  // oscurecido/partículas/texto del premio (depth ≥20) — así queda exactamente en
  // el orden rieles -> mascota -> oscurecido -> texto, sin competir por capas con
  // el DOM (ver game/gifMascot.ts).
  private static readonly MASCOT_DEPTH = 15;

  private showMascot(durationMs: number) {
    const frames = this.mascotFrames;
    const staticKey = this.mascotStaticKey;
    if (!frames && !staticKey) return;
    const cx = this.W / 2;
    const cy = this.gridY + this.gridH / 2;
    const maxW = Math.min(this.W * 0.94, this.gridW * 1.35);
    const maxH = Math.min(this.H * 0.78, this.gridH * 1.55);
    const initialKey = frames ? frames.keys[0] : staticKey!;

    if (!this.mascotImg) {
      this.mascotImg = this.add.image(cx, cy, initialKey).setDepth(SlotScene.MASCOT_DEPTH).setAlpha(0);
    } else {
      this.mascotImg.setTexture(initialKey).setPosition(cx, cy).setDepth(SlotScene.MASCOT_DEPTH);
    }
    this.fitImage(this.mascotImg, maxW, maxH);
    this.mascotImg.setVisible(true);
    this.tweens.add({ targets: this.mascotImg, alpha: 1, duration: 300, ease: "Sine.easeOut" });

    this.mascotFrameTimer?.remove(false);
    if (frames) {
      this.mascotFrameIdx = 0;
      const step = () => {
        if (!this.mascotImg || !frames) return;
        this.mascotFrameIdx = (this.mascotFrameIdx + 1) % frames.keys.length;
        this.mascotImg.setTexture(frames.keys[this.mascotFrameIdx]);
        this.fitImage(this.mascotImg, maxW, maxH);
        this.mascotFrameTimer = this.time.delayedCall(frames.delays[this.mascotFrameIdx], step);
      };
      this.mascotFrameTimer = this.time.delayedCall(frames.delays[0], step);
    }

    this.time.delayedCall(durationMs, () => this.hideMascot());
  }

  private hideMascot(immediate = false) {
    this.mascotFrameTimer?.remove(false);
    this.mascotFrameTimer = undefined;
    if (!this.mascotImg) return;
    if (immediate) {
      this.mascotImg.setAlpha(0);
      return;
    }
    this.tweens.add({ targets: this.mascotImg, alpha: 0, duration: 350, ease: "Sine.easeIn" });
  }






  // Premio normal (horizontal): banner GANASTE reutilizable sobre el borde
  // inferior del marco + conteo con throttle. La GANANCIA de la barra ya quedó
  // actualizada en present().
  private normalWin(resp: SpinResponse) {
    sfx.win();
    this.highlightWins(resp);
    if (!this.hud) return;
    this.rollUpText(this.hud.showWinBanner(), "", resp.total_win, this.turbo ? 320 : 750);
  }

  // ====================================================================== //
  // BIG WIN horizontal — mismo cálculo/acreditación de siempre (ya ocurrió   //
  // antes de present()); solo cambia cómo se anima: rayos como TEXTURA (no   //
  // Graphics re-teselado por frame), partículas de emisores persistentes y   //
  // con tope, y TODOS los tweens infinitos se quitan al terminar. Se salta   //
  // con clic o ESPACIO.                                                     //
  // ====================================================================== //
  private bigWinDesktop(resp: SpinResponse, tier: WinTier) {
    sfx.bigWin();
    this.highlightWins(resp);
    const highlightMs = this.turbo ? 250 : 900;
    this.time.delayedCall(highlightMs, () => this.celebrateBigWinDesktop(resp, tier));
  }

  // Degradados de 3 tonos por nivel — los de CONFIG_MOBILE ("epic" en WinTier
  // equivale a "super" en móvil).
  private static readonly DESKTOP_WIN_GRADIENT: Record<WinTier, [string, string, string]> = {
    big: CONFIG_MOBILE.celebration.tiers.big.gradient,
    mega: CONFIG_MOBILE.celebration.tiers.mega.gradient,
    epic: CONFIG_MOBILE.celebration.tiers.super.gradient,
    jackpot: CONFIG_MOBILE.celebration.tiers.jackpot.gradient,
  };
  private static readonly RAYS_TEX = "tex-rays";
  private static readonly VIGNETTE_TEX = "tex-vignette";
  private static readonly BAKED_SUFFIX = "-d";

  private celebrateBigWinDesktop(resp: SpinResponse, tier: WinTier) {
    const cfg = SlotScene.TIER_CFG[tier];
    const gradient = SlotScene.DESKTOP_WIN_GRADIENT[tier];
    const FX = CONFIG_DESKTOP.effects;
    const OV = CONFIG_DESKTOP.depth.overlays;
    this.winOverlayActive = true;
    this.cameras.main.shake(cfg.shakeMs, cfg.shakeI);
    if (this.mascotFrames || this.mascotStaticKey) this.showMascot(cfg.holdMs + 400);

    const cx = this.W / 2;
    const cy = this.gridY + this.gridH / 2;
    // El overlay cubre todo y está por encima del HUD: el clic cierra la
    // celebración en vez de disparar un giro nuevo.
    const overlay = this.add.rectangle(0, 0, this.W, this.H, 0x000000, 0.68).setOrigin(0).setDepth(OV).setInteractive();
    this.transient.push(overlay);

    const rayLen = Math.max(this.W, this.H) * 0.9;
    const rays = this.add
      .image(cx, cy, SlotScene.RAYS_TEX)
      .setTint(hexToNum(cfg.color, 0xffd23f))
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(rayLen * 2, rayLen * 2)
      .setAlpha(CONFIG_DESKTOP.effects.raysAlpha)
      .setDepth(OV + 1);
    this.transient.push(rays);
    const raysTween = this.tweens.add({ targets: rays, angle: 360, duration: 9000, repeat: -1, ease: "Linear" });

    this.coinFx?.explode(Math.min(FX.maxCoins, Math.round(cfg.coins * FX.particleScale)), cx, cy - 40);
    this.confettiFx?.explode(Math.min(FX.maxConfetti, Math.round(cfg.confetti * FX.particleScale)), cx, cy - 60);

    const banner = this.add.container(cx, cy).setDepth(OV + 10);
    const titleText = this.goldGradientText(0, -56, cfg.title, Math.round(Math.min(this.W * 0.06, 104)), "#2b1604", gradient);
    this.crisp(titleText);
    const amountText = this.add
      .bitmapText(0, 52, CONFIG_DESKTOP.text.bitmapFontKey, this.money(0), 76)
      .setOrigin(0.5)
      .setTint(CONFIG_DESKTOP.text.goldTop, CONFIG_DESKTOP.text.goldTop, CONFIG_DESKTOP.text.goldBottom, CONFIG_DESKTOP.text.goldBottom);
    banner.add([titleText, amountText]);
    banner.setScale(0);
    this.transient.push(banner);

    this.tweens.add({ targets: banner, scale: 1, duration: 550, ease: "Back.easeOut" });
    const wobble = this.tweens.add({ targets: titleText, angle: { from: -4, to: 4 }, duration: 500, yoyo: true, repeat: -1 });
    this.rollUpText(amountText, "", resp.total_win, cfg.rollMs);

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      this.winOverlayActive = false;
      dismissTimer.remove(false);
      raysTween.remove();
      wobble.remove();
      this.input.keyboard?.off("keydown-SPACE", finish);
      this.tweens.add({
        targets: [overlay, banner, rays],
        alpha: 0,
        duration: 300,
        onComplete: () => this.clearTransient(),
      });
      if (this.pendingRelayout) this.onResize(this.scale.gameSize);
    };
    overlay.once("pointerdown", finish);
    this.input.keyboard?.on("keydown-SPACE", finish);
    const dismissTimer = this.time.delayedCall(cfg.holdMs, finish);
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
      .setDepth(this.isMobile ? 9 : CONFIG_DESKTOP.depth.winBanner);
    this.crisp(msg);
    this.transient.push(msg);
    this.time.delayedCall(2500, () => msg.destroy());
  }
}
