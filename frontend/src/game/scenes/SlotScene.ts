import Phaser from "phaser";
import { SYMBOLS, PAYLINES, WIN_TIERS, TEX } from "../constants";
import type { WinTier } from "../constants";
import { Reel } from "../Reel";
import { sfx } from "../sfx";
import type { SpinResponse } from "../../api/spinApi";
import type { RuntimeConfig } from "../config";
import type { MascotFrames } from "../gifMascot";
import { CONFIG_MOBILE, MOBILE_FONT, designScaleFactor } from "../mobile/configMobile";
import { CONFIG_DESKTOP } from "../desktop/configDesktop";

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
  private size = 150; // ancho de celda/columna
  private cellH = 150; // SOLO MÓVIL (Corrección 4): alto de celda si es distinto del ancho (celdas 4:5)
  private gridX = 45;
  private gridY = 170;
  private gridW = 450;
  private gridH = 450;
  private panelPad = 20; // margen entre la rejilla y el borde de caramelo
  private portrait = false; // móvil (vertical) vs escritorio (horizontal)
  private isMobile = false; // dispositivo táctil real (ver CONFIG_MOBILE) — aísla la Fase 1 de escritorio
  // DESKTOP (Fase 1): "zona segura" del contenido — nunca más ancha que
  // `H * CONFIG_DESKTOP.safeZone.maxAspect`, centrada dentro de `this.W` real.
  // En monitores ultra anchos el contenido queda acotado y centrado; el fondo
  // (aparte, drawBackground) sí usa todo `this.W`. Ver computeLayoutDesktop().
  private contentX = 0;
  private contentW = 1920;
  // FASE 2 DESKTOP (punto 1): parallax leve del fondo con el mouse — posición
  // BASE (centro de pantalla) + un offset que se acerca suavemente (lerp, en
  // update()) al que marca el puntero. Separar base/offset evita que dos
  // tweens se peleen por la misma propiedad (el mismo bug que hubo que
  // arreglar en el fade de changeBet() en móvil, Fase 7 auditoría).
  private bgImageDesktop?: Phaser.GameObjects.Image;
  private bgBaseX = 0;
  private bgBaseY = 0;
  private bgParallaxTargetX = 0;
  private bgParallaxTargetY = 0;
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
  private winPanelH = 70; // alto del panel redondeado de GANANCIA (móvil, adosado a la rejilla)
  private prizeBannerImg?: Phaser.GameObjects.Image; // banner de premio (solo visible al ganar)
  private bannerY = 700;
  private buttonY = 850;
  private barTop = 800;
  private footerH = 160; // alto real del footer (puede diferir de `H - barTop` si hay margen debajo)

  private winGfx!: Phaser.GameObjects.Graphics;
  private winText!: Phaser.GameObjects.Text;
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
  private currency = "USD";
  private curSymbol = "$";
  private curExp = 2;
  private accent = 0xffd23f; // color predominante del tema (numérico, para gráficos)
  private accentHex = "#ffd23f"; // mismo color en texto (para estilos de Text)
  private balanceValue!: Phaser.GameObjects.Text;
  private betValue!: Phaser.GameObjects.Text;
  // REORGANIZACIÓN móvil: la APUESTA ahora se muestra DOS veces (pastilla
  // interactiva con −/+ + eco de solo lectura en la fila de estadísticas del
  // fondo, como en la referencia) — `betValueEcho` es ese segundo texto,
  // actualizado junto con `betValue` en changeBet(). `undefined` en
  // cualquier otro modo (nunca se asigna ahí), así que el `?.` es inerte.
  private betValueEcho?: Phaser.GameObjects.Text;
  private winValue!: Phaser.GameObjects.Text;
  private winGroup!: Phaser.GameObjects.Container; // GANANCIA (se oculta al mostrar el banner)
  private legalText?: Phaser.GameObjects.Text; // SOLO MÓVIL: línea diminuta con el ID de la última ronda
  // SOLO MÓVIL (Corrección 4, punto 0): pastillas de CRÉDITO/APUESTA (antes
  // "línea de texto"), para poder pulsarlas desde onSpin()/changeBet().
  private creditPill?: { pulse: () => void };
  private betPill?: { pulse: () => void };
  // CORRECCIÓN 1: bounding boxes del HUD móvil para el modo debug (ver
  // CONFIG_MOBILE.debug.enabled, debugRegisterBox, debugCheckOverlaps).
  private debugBoxes: { name: string; x: number; y: number; w: number; h: number }[] = [];
  // DIAGNÓSTICO D1b (temporal, SOLO escritorio): referencias con nombre a los
  // GameObjects reales del HUD de escritorio, para poder volcarlos por
  // consola (ver debugTrack/debugDumpObjects) — independiente de los
  // bounding boxes de debugBoxes (esos son solo rectángulos AABB para
  // detectar solapes, no objetos reales con depth/alpha/textura).
  private debugObjects: { name: string; obj: Phaser.GameObjects.GameObject }[] = [];
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
  private musicBtn?: Phaser.GameObjects.Image;
  private musicToggleMobile?: Toggle; // SOLO MÓVIL: ícono de SONIDO dibujado por código (ver CORRECCIÓN 1)
  private musicToggleDesktop?: Toggle; // FASE 3 DESKTOP: idem, ícono de SONIDO siempre dibujado por código
  // CORRECCIÓN D2 (punto 3, SOLO ESCRITORIO): texto de ayuda de turbo — se
  // desvanece solo tras la primera tirada (ver onSpin()). `undefined` en
  // móvil siempre (nunca se asigna ahí), así que el chequeo en onSpin() es
  // inerte para ese modo.
  private turboHintText?: Phaser.GameObjects.Text;
  private musicMuted = false;
  private musicX = 0;
  private musicY = 0;
  private musicR = 24;

  constructor() {
    super("Slot");
  }

  create() {
    this.runtime = this.registry.get("runtime") as RuntimeConfig;
    this.isMobile = (this.registry.get("isMobile") as boolean) ?? false;
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

    this.computeLayout();
    this.drawBackground();
    this.drawPanel();
    // Fase 3: en móvil real la GANANCIA es solo texto (sin caja), así que no se
    // dibuja la cápsula. El fallback de ventana angosta no táctil (desktop) la
    // conserva, sin cambios.
    if (this.portrait && !this.isMobile) this.drawWinPanel();
    // FASE 2 DESKTOP (punto 2): personajes decorativos en los márgenes
    // laterales, DETRÁS del marco (depth bajo) — ver drawDesktopDecorCharacters().
    if (!this.isMobile && !this.portrait) this.drawDesktopDecorCharacters();
    this.buildReels();

    this.winGfx = this.add.graphics().setDepth(5);
    this.drawTitle();
    this.drawBanner();

    // CORRECCIÓN 3 (punto 5, SOLO MÓVIL): el roll-up "GANASTE $x" vivía en
    // Arial aunque el resto del HUD móvil ya usa la tipografía cartoon —
    // único texto que se había quedado afuera. Escritorio sigue en Arial.
    this.winText = this.add
      .text(this.W / 2, this.bannerY, "", {
        fontFamily: this.isMobile ? MOBILE_FONT : "Arial, sans-serif",
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

    // Fase 3 móvil: HUD propio y aislado (buildControlsMobile). FASE 3
    // DESKTOP: idem para escritorio real (buildControlsDesktop, nuevo) — el
    // fallback de ventana angosta no táctil sigue con buildControls() tal
    // cual estaba (ya no se llama para escritorio real, así que sus ramas
    // `!P` quedan sin usar ahí, pero no se tocaron para no arriesgar el
    // único camino que SÍ sigue vivo, el del fallback).
    if (this.isMobile) this.buildControlsMobile();
    else if (this.portrait) this.buildControls();
    else this.buildControlsDesktop();
    // Fase 1 desktop: botón de pantalla completa + tecla F + debug de zonas.
    // Solo para escritorio real (no el fallback de ventana angosta no táctil,
    // que sigue siendo una ventana normal de navegador, no un "juego a pantalla
    // completa") — ver buildDesktopExtras().
    if (!this.isMobile && !this.portrait) this.buildDesktopExtras();
    this.setupMusic();
    this.resetIdleTimer();

    this.input.keyboard?.on("keydown-SPACE", () => this.onSpin());

    // FASE 4 DESKTOP (punto 2): atajos de teclado adicionales — mantener
    // ESPACIO activa turbo (← → cambian la apuesta, M silencia; F ya existe,
    // ver buildDesktopExtras). Atados aparte del listener de arriba (Phaser
    // permite varios por evento) para no tocar el spin básico, que sí es
    // compartido con móvil/fallback.
    if (!this.isMobile) {
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
    }

    // Recalcular al redimensionar la ventana (solo si no está girando).
    this.scale.on("resize", this.onResize, this);
    this.events.once("shutdown", () => {
      this.scale.off("resize", this.onResize, this);
      this.music?.stop();
      this.idleTimer?.remove(false);
      this.winCycleTimer?.remove(false);
      this.mascotFrameTimer?.remove(false);
    });
  }

  private onResize(size: Phaser.Structs.Size) {
    if (this.busy) return;
    // NOTA (CORRECCIÓN 7): `size` es `this.scale.gameSize` — la resolución de
    // DISEÑO, no el tamaño real. En móvil (Scale.FIT) esa resolución se fija
    // una sola vez al crear el juego (ver `mobileDesignHeight` en config.ts,
    // calculada para igualar la proporción real del contenedor y así evitar
    // el letterboxeo) y NO se vuelve a recalcular sola en cada resize — por
    // eso esta comparación nunca dispara un restart en móvil hoy. Si el
    // contenedor cambia de PROPORCIÓN de verdad a mitad de sesión (rotación,
    // barra de direcciones del navegador, teclado en pantalla), haría falta
    // además llamar a `this.scale.setGameSize(...)` con la proporción nueva
    // antes de este chequeo — no implementado todavía porque no se ha
    // reportado como problema (el aviso de "gira tu teléfono" ya tapa el caso
    // más común, la rotación a horizontal).
    if (Math.abs(size.width - this.W) < 2 && Math.abs(size.height - this.H) < 2) return;
    this.scene.restart();
  }

  update(_time: number, dtMs: number) {
    for (const reel of this.reels) {
      reel.update(dtMs);
      reel.render();
    }
    // FASE 2 DESKTOP (punto 1): acerca el fondo a su objetivo de parallax un
    // poco en cada frame (lerp) — nunca de golpe, para que se sienta suave.
    if (this.bgImageDesktop) {
      const t = Math.min(1, dtMs / 220);
      this.bgImageDesktop.x = Phaser.Math.Linear(this.bgImageDesktop.x, this.bgBaseX + this.bgParallaxTargetX, t);
      this.bgImageDesktop.y = Phaser.Math.Linear(this.bgImageDesktop.y, this.bgBaseY + this.bgParallaxTargetY, t);
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

  private computeLayout() {
    const W = this.scale.width;
    const H = this.scale.height;
    this.W = W;
    this.H = H;
    this.portrait = H > W;

    // DIAGNÓSTICO (temporal): cuál de las TRES rutas de layout se eligió —
    // móvil real, el fallback de ventana angosta NO táctil (el HUD viejo,
    // de antes del rediseño móvil), o escritorio real. Incondicional (no
    // depende de ningún flag de debug): sirve para confirmar, con una sola
    // mirada a la consola, si "se ve como antes" es porque `isMobile` salió
    // `false` (cae al fallback viejo a propósito, por diseño) o es un bug de
    // verdad en el HUD móvil nuevo.
    // eslint-disable-next-line no-console
    console.log("SLOT_LAYOUT_PATH", {
      path: this.isMobile && this.portrait ? "MOBILE_REAL" : this.portrait ? "FALLBACK_NARROW_NOT_TOUCH" : "DESKTOP_REAL",
      isMobile: this.isMobile,
      portrait: this.portrait,
      W,
      H,
    });

    if (this.portrait && this.isMobile) {
      // MÓVIL REAL (pantalla táctil, Fase 1): geometría dirigida por
      // CONFIG_MOBILE, aislada del resto — ver computeLayoutMobile(). El
      // bloque `else if (this.portrait)` de abajo queda intacto como fallback
      // para una ventana de escritorio angosta (no táctil), que no es "móvil".
      this.computeLayoutMobile();
    } else if (this.portrait) {
      // VENTANA ANGOSTA NO TÁCTIL (fallback, sin cambios): logo arriba
      // (compacto), rejilla a TODO el ancho y lo más grande posible, controles
      // apilados debajo (giro centrado + crédito/apuesta + fila de iconos).
      const headerH = Math.max(76, H * 0.095);
      const footerMin = 130; // piso del panel de botones, nunca más chico que esto
      const maxGridW = W * 0.98;
      // La rejilla queda PEGADA justo bajo el header (título arriba del todo, debajo
      // de la franja negra del letterbox). Con pocas columnas el ANCHO manda sobre
      // el alto, así que `size` se calcula contra una cota de alto floja (footerMin):
      // en la práctica casi siempre gana el ancho, da igual el footer final.
      const roughGridArea = H - headerH - footerMin;
      this.size = Math.floor(Math.min(maxGridW / this.cols, roughGridArea / this.rows, 200));
      this.gridW = this.size * this.cols;
      this.gridH = this.size * this.rows;
      this.gridX = (W - this.gridW) / 2;
      this.gridY = headerH;
      this.panelPad = Math.round(this.size * 0.12);
      // Panel de GANANCIA: adosado al borde exterior del panel de la rejilla (mismo
      // estilo, esquinas inferiores — ver drawPanel/drawWinPanel), no una franja
      // suelta con hueco.
      this.winPanelH = Math.round(this.size * 0.44);
      const winPanelBottom = this.gridY + this.gridH + this.panelPad + this.winPanelH;
      this.winRowY = this.gridY + this.gridH + this.panelPad + this.winPanelH / 2;
      // Un margen chico ENTRE el panel de GANANCIA y el footer deja asomar el fondo
      // del tema ahí (si el footer arranca justo pegado a la rejilla, se ve
      // demasiado apretado, sin aire). El footer sigue pegado al borde INFERIOR de
      // la pantalla (eso ya estaba bien) y CRECE hacia arriba para ocupar el resto
      // del sobrante (nunca baja de footerMin): el sobrante de alto se distribuye
      // entre sus filas (giro / crédito-apuesta / iconos, ya espaciadas por
      // fracción de `barH` en buildControls) en vez de quedar como hueco vacío.
      const midGap = Math.max(14, H * 0.02);
      const footerH = Math.max(footerMin, H - winPanelBottom - midGap);
      // MÓVIL: logo/título, compacto, arriba del todo.
      this.logoY = headerH * 0.52;
      this.logoX = W / 2;
      this.logoAngle = 0;
      this.logoMaxW = W * 0.95;
      this.logoMaxH = headerH * 1.05;
      this.barTop = H - footerH;
      this.footerH = footerH;
    } else {
      // ESCRITORIO (horizontal): ver computeLayoutDesktop() — Fase 1 del
      // rediseño de escritorio (CONFIG_DESKTOP), aislado del resto de esta
      // función. Deja fijados los mismos campos que antes (gridX/Y/W/H,
      // panelPad, logoX/Y/MaxW/MaxH/Angle, barTop, footerH, topInfoY), así que
      // drawTitle/drawPanel/buildControls siguen funcionando sin tocarlos.
      this.computeLayoutDesktop();
    }
    // Celda cuadrada en escritorio y en el fallback de ventana angosta no
    // táctil (ninguno de los dos pasa por computeLayoutMobile, que es el
    // único lugar que fija `cellH` distinto de `size` — Corrección 4, punto 3).
    if (!this.isMobile) this.cellH = this.size;

    this.buttonY = this.barTop + this.footerH * 0.5;
    // Franja superior donde va la GANANCIA: en escritorio YA la fija
    // computeLayoutDesktop() (debajo del marco, Fase 1 punto 4) — acá solo se
    // calcula para los casos portrait, donde en realidad no se usa: `bannerY`
    // de abajo toma `winRowY` en su lugar para esos dos casos.
    if (this.isMobile || this.portrait) {
      this.topInfoY = Math.max(28, this.gridY - this.panelPad * 1.1);
    }
    // Banner+GANASTE: en PC arriba (zona de GANANCIA); en móvil REAL, pegado
    // al marco vía `celebrationY` (REORGANIZACIÓN: ya NO es `winRowY` — ese
    // campo ahora apunta a la pastilla de GANANCIA en el fondo del footer,
    // un lugar demasiado chico/abajo para la celebración grande); en el
    // fallback de ventana angosta no táctil, sigue usando `winRowY` como
    // siempre (esa rama no cambió). Ancho acotado para no desbordar.
    this.bannerY = this.isMobile && this.portrait ? this.celebrationY : this.portrait ? this.winRowY : this.topInfoY;
    this.winMaxW = this.portrait ? this.gridW * 0.82 : this.gridW * 0.5;
  }

  // ====================================================================== //
  // LAYOUT ESCRITORIO (Fase 1 del rediseño desktop) — módulo aislado: solo  //
  // se llama cuando !this.isMobile && !this.portrait. Dirigido por         //
  // CONFIG_DESKTOP, con la misma idea que computeLayoutMobile(): deja       //
  // fijados los mismos campos que ya consume el resto de la clase          //
  // (gridX/Y/W/H, panelPad, logoX/Y/MaxW/MaxH/Angle, barTop, footerH,      //
  // topInfoY), así drawTitle/drawPanel/buildControls siguen funcionando    //
  // sin tocarlos — Fase 1 es solo estructura, no arte (eso llega en fases   //
  // siguientes, cuando se reescriban esos métodos para escritorio).        //
  //                                                                        //
  // Escritorio usa Scale.RESIZE (ver game/config.ts): `this.W`/`this.H`    //
  // SON el tamaño REAL de la ventana en todo momento — a diferencia de     //
  // móvil (Scale.FIT + resolución de diseño), acá NO hace falta ningún     //
  // truco de conversión "diseño -> real": todo lo que se calcula contra    //
  // `H`/`W` YA es real, y se recalcula solo en cada resize/fullscreen vía   //
  // el `this.scale.on("resize", ...)` ya existente (ver onResize), que en  //
  // modo RESIZE sí dispara en cada cambio real (a diferencia de FIT).      //
  // ====================================================================== //
  private computeLayoutDesktop() {
    // DIAGNÓSTICO D1b: identificador único para confirmar en la consola del
    // navegador que ESTA función (y no otra ruta de código) es la que
    // construye el layout de escritorio en la pestaña que el usuario tiene
    // abierta. Incondicional (no depende de CONFIG_DESKTOP.debug.enabled):
    // debe verse SIEMPRE, una vez por cada creación/reinicio de la escena
    // (create() -> computeLayout() -> computeLayoutDesktop()). Si no
    // aparece, o aparece con un `W`/`H` que no coincide con la ventana real,
    // el problema NO está en este archivo — ver respuesta para más detalle.
    // eslint-disable-next-line no-console
    console.log("DESKTOP_LAYOUT_V2", {
      W: this.W,
      H: this.H,
      isMobile: this.isMobile,
      portrait: this.portrait,
      ts: Date.now(),
    });
    const W = this.W;
    const H = this.H;
    const D = CONFIG_DESKTOP;

    // "Zona segura" (punto 2): el CONTENIDO (logo + rodillos + HUD) nunca es
    // más ancho que `H * maxAspect` (16:9) — en monitores ultra anchos
    // (21:9) se queda centrado en una proporción cómoda en vez de estirarse;
    // el FONDO (aparte, ver drawBackground, que ya cubre contra `W`/`H`
    // reales) sí se extiende y llena los costados.
    this.contentW = Math.min(W, H * D.safeZone.maxAspect);
    this.contentX = (W - this.contentW) / 2;

    const gapMin = Math.max(10, H * D.zones.gapMinPct);
    const logoZoneH = H * D.zones.logoPct;
    const controlBarH = H * D.zones.controlBarPct;
    const G = D.ganancia;

    // Barra de control (punto 4): "ancla al borde real inferior" — en
    // Scale.RESIZE `H` YA es el alto real, así que esto SIEMPRE llega al
    // verdadero borde inferior de la ventana, sin importar el resize.
    this.footerH = controlBarH;
    this.barTop = H - controlBarH;

    // FASE 2 (punto 2): el marco ya NO usa casi todo el ancho de la zona
    // segura — deja margen a los lados para los personajes decorativos
    // (CONFIG_DESKTOP.grid.widthPct, antes 0.92 fijo acá mismo).
    const maxGridW = this.contentW * D.grid.widthPct;
    // El marco (punto 4) sobresale `panelPad` más allá de la rejilla en las
    // CUATRO direcciones — eso hay que reservarlo ANTES de saber `size` (que
    // es lo que determina `panelPad`), si no el marco podía terminar
    // pisando el logo arriba o la barra de control abajo en resoluciones
    // bajas. Se estima con una cota superior (el tamaño que tendría la celda
    // si el ANCHO fuera el único límite, que siempre es `>=` el tamaño
    // final) y se reserva esa cota en vez del `panelPad` real — circular de
    // otro modo.
    const estPanelPad = Math.round((maxGridW / this.cols) * 0.16);
    // CORRECCIÓN D2 (punto 3): el alto reservado para GANANCIA ya NO es un %
    // de `H` desconectado del tamaño real del texto (antes `winBandPct`,
    // que en 1280x720 reservaba 36px para un bloque de texto de ~61px reales
    // — dejaba apenas ~3px antes de la barra en vez de los 16 pedidos). Se
    // calcula con la MISMA fórmula que usará `drawWinInfoDesktop()` —
    // winInfoMetrics() vive aparte para que las dos SIEMPRE coincidan — pero
    // con una COTA SUPERIOR de `gridW` (la del ancho, antes de saber si el
    // alto termina acotando más chico), por la misma razón que `estPanelPad`:
    // si el texto real sale más chico, sobra margen; nunca al revés.
    const estMetrics = this.winInfoMetrics(maxGridW);
    const ganaciaReserved = G.gapAboveFramePx + estMetrics.topOffset + estMetrics.bottomOffset + G.gapBelowToBarPx;
    const headerH = logoZoneH + gapMin + estPanelPad;
    const availH = this.barTop - headerH - ganaciaReserved - estPanelPad;
    this.size = Math.floor(Math.min(maxGridW / this.cols, availH / this.rows, 220));
    this.gridW = this.size * this.cols;
    this.gridH = this.size * this.rows;
    this.gridX = this.contentX + (this.contentW - this.gridW) / 2;
    this.gridY = headerH + Math.max(0, (availH - this.gridH) / 2);
    this.panelPad = Math.round(this.size * 0.16); // siempre <= estPanelPad

    // Logo (punto 4): franja superior, CENTRADO sobre los rodillos — antes
    // iba en la esquina superior-izquierda, inclinado; se deja de usar esa
    // posición (el reemplazo visual de esa esquina llega en una fase de arte).
    this.logoX = this.contentX + this.contentW / 2;
    this.logoY = logoZoneH * 0.52;
    this.logoAngle = 0;
    this.logoMaxW = Math.min(this.contentW * 0.4, 420);
    this.logoMaxH = logoZoneH * 0.85;

    // Franja de GANANCIA (punto 3): el borde SUPERIOR de la etiqueta queda
    // exactamente `gapAboveFramePx` debajo del marco, y el borde INFERIOR
    // del monto queda con AL MENOS `gapBelowToBarPx` antes de la barra
    // (garantizado por la reserva de arriba — nunca menos, puede sobrar si
    // `size` terminó acotado por ancho en vez de alto). Usa la fórmula REAL
    // (gridW final, no la cota superior) — ver winInfoMetrics().
    const frameBottom = this.gridY + this.gridH + this.panelPad;
    const metrics = this.winInfoMetrics(this.gridW);
    this.topInfoY = frameBottom + G.gapAboveFramePx + metrics.topOffset;
  }

  // Tamaños/offsets del texto de GANANCIA, a partir del ancho de la rejilla.
  // Separado de drawWinInfoDesktop() para que computeLayoutDesktop() pueda
  // RESERVAR el espacio exacto que ese método va a pintar — si alguna vez se
  // cambian los tamaños de letra, basta con tocarlos aquí UNA vez.
  private winInfoMetrics(gridW: number) {
    const labelSize = Math.max(16, Math.round(gridW * 0.026));
    const valueSize = Math.max(24, Math.round(gridW * 0.05));
    return {
      labelSize,
      valueSize,
      topOffset: valueSize * 0.62 + labelSize / 2, // del centro (winY) al borde SUPERIOR de la etiqueta
      bottomOffset: labelSize * 0.6 + valueSize / 2, // del centro (winY) al borde INFERIOR del monto
    };
  }

  private drawBackground() {
    // CORRECCIÓN 1 (punto 3): en móvil el fondo (imagen/degradado/color) y el
    // oscurecido YA los pinta la capa DOM (.slot-bg-cover/.slot-bg-video en
    // SlotGameCanvas.tsx — Fase 1) y el oscurecido propio del footer
    // (buildControlsMobile). Pintar TAMBIÉN una copia dentro de Phaser creaba
    // el "corte duro": el canvas (Scale.FIT) solo cubre la franja central de
    // la pantalla, así que esa copia interna terminaba en un recorte/zoom
    // DISTINTO al de la capa DOM (que cubre el alto completo del dispositivo)
    // — dos "cover" independientes del mismo recurso casi nunca calzan en el
    // borde, de ahí la costura y la franja de color distinto debajo. La
    // solución es que exista UNA sola capa pintando el fondo (la DOM, que sí
    // cubre el 100% de la pantalla de punta a punta) — el canvas de Phaser es
    // transparent:true en móvil (ver game/config.ts) y aquí no pinta nada
    // opaco: la rejilla/HUD flotan directamente sobre la capa DOM. Escritorio
    // NO tiene esa capa DOM para imagen/degradado estáticos, así que sigue
    // pintando todo esto dentro de Phaser exactamente como antes.
    if (!this.isMobile && this.portrait) {
      // FALLBACK de ventana angosta no táctil: SIN CAMBIOS (lo de siempre).
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
      const isVideoBg =
        this.runtime.theme?.background_type === "VIDEO" && !!this.runtime.theme?.assets?.background_video;
      if (isVideoBg) {
        // nada que pintar: el vídeo se ve por debajo del canvas transparente.
      } else if (this.textures.exists(TEX.bg)) {
        const bg = this.add.image(this.W / 2, this.H / 2, TEX.bg).setDepth(-10);
        const t = bg.texture.getSourceImage();
        const cover = Math.max(this.W / t.width, this.H / t.height);
        bg.setScale(cover).setAlpha(1);
      }
      const g = this.add.graphics().setDepth(-8);
      g.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, 0, 0.45, 0.45);
      g.fillRect(0, this.H * 0.66, this.W, this.H * 0.34);
    } else if (!this.isMobile && !this.portrait) {
      // FASE 2 DESKTOP (punto 1): fondo propio, aislado del resto.
      this.drawBackgroundDesktop();
    }

    // SOLO MÓVIL (Fase 2): elementos decorativos flotando (placeholder genérico
    // — sin arte específico de "rosquillas/nubes" todavía, ver mensaje final de
    // la fase). Chispas/destellos que derivan lento hacia arriba y se desvanecen,
    // en bucle, por detrás del panel de la rejilla.
    if (this.isMobile) this.buildMobileFloatingFx();
  }

  // ====================================================================== //
  // FONDO DESKTOP (Fase 2, punto 1) — módulo aislado: solo se llama cuando   //
  // !isMobile && !portrait. Menos contraste/saturación, desenfoque suave,   //
  // parallax leve con el mouse (ver update()) y "rosquillas" flotantes      //
  // (placeholder — sin arte dedicado todavía, ver mensaje final de fase).  //
  // ====================================================================== //
  private drawBackgroundDesktop() {
    const D = CONFIG_DESKTOP.background;
    const DEPTH = CONFIG_DESKTOP.depth;

    if (this.runtime.theme?.background_type === "GRADIENT") {
      const cols = (this.runtime.theme?.background_gradient || "")
        .split(",").map((s) => s.trim()).filter(Boolean);
      if (cols.length) {
        const top = hexToNum(cols[0], 0x101827);
        const bot = hexToNum(cols[cols.length - 1], 0x05030f);
        const grad = this.add.graphics().setDepth(DEPTH.background);
        grad.fillGradientStyle(top, top, bot, bot, 1, 1, 1, 1);
        grad.fillRect(0, 0, this.W, this.H);
      }
    }
    const isVideoBg =
      this.runtime.theme?.background_type === "VIDEO" && !!this.runtime.theme?.assets?.background_video;
    if (isVideoBg) {
      // nada que pintar: el vídeo se ve por debajo del canvas transparente.
    } else if (this.textures.exists(TEX.bg)) {
      const bg = this.add.image(this.W / 2, this.H / 2, TEX.bg).setDepth(DEPTH.background);
      const t = bg.texture.getSourceImage();
      const cover = Math.max(this.W / t.width, this.H / t.height);
      // Punto 1: "aligéralo para que no compita con los símbolos" — menos
      // contraste/saturación (ColorMatrix FX, Phaser 3.60+) + un desenfoque
      // suave general (Blur FX). Ambos son efectos nuevos de Phaser que no
      // existían en versiones viejas — si el navegador no soporta WebGL2,
      // `preFX` devuelve `null` y esto simplemente no se aplica (fallback
      // silencioso, no rompe nada).
      bg.preFX?.addColorMatrix().contrast(D.contrast, true).saturate(D.saturation, true);
      bg.preFX?.addBlur(0, 0.6, 0.6, D.blurStrength, 0xffffff, 3);
      // Oversize leve (punto 1, "parallax leve"): un poco más grande que el
      // cover exacto, para tener margen de sobra al desplazarlo con el mouse
      // sin que se vean bordes — MISMA lección que en móvil (Corrección 5,
      // punto 9): cuanto más oversize, más se recorta el arte de los bordes,
      // así que se deja el mínimo necesario para el desplazamiento.
      bg.setScale(cover * D.oversizeForParallax).setAlpha(1);
      this.debugTrack("FONDO imagen (TV/rosquillas horneadas en el arte)", bg);
      this.bgImageDesktop = bg;
      this.bgBaseX = this.W / 2;
      this.bgBaseY = this.H / 2;
      this.bgParallaxTargetX = 0;
      this.bgParallaxTargetY = 0;
      // El puntero mueve el fondo en sentido CONTRARIO (como si la cámara se
      // asomara) — un `pointermove` por frame actualiza solo el OBJETIVO; el
      // acercamiento real pasa por un lerp en update(), así nunca hay dos
      // tweens compitiendo por bg.x/bg.y (ver nota del campo arriba).
      this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
        const nx = Phaser.Math.Clamp((p.x / this.W - 0.5) * 2, -1, 1);
        const ny = Phaser.Math.Clamp((p.y / this.H - 0.5) * 2, -1, 1);
        this.bgParallaxTargetX = -nx * D.parallaxMaxPx;
        this.bgParallaxTargetY = -ny * D.parallaxMaxPx * 0.6;
      });
    }
    // Viñeta inferior suave para que la barra de control se siga leyendo bien
    // sobre el fondo ya aclarado.
    const g = this.add.graphics().setDepth(DEPTH.background + 2);
    g.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, 0, 0.4, 0.4);
    g.fillRect(0, this.H * 0.66, this.W, this.H * 0.34);
    this.debugTrack("FONDO viñeta inferior", g);

    // CORRECCIÓN D1 (punto 4): "que el logo tenga ~30px de aire libre
    // alrededor" — el fondo real del tema puede traer elementos (TV,
    // rosquilla) pintados cerca de donde cae el logo; no se puede "mover"
    // contenido ya horneado en una imagen subida, así que se le pone un
    // respaldo oscuro sutil detrás (depth bajo, entre la decoración del
    // fondo y el logo) que despeja esa zona sin importar qué haya en la
    // imagen. Define también la "zona prohibida" donde NO deben aparecer las
    // rosquillas de código (más abajo).
    const logoPadding = 30;
    const logoBoxX0 = this.logoX - this.logoMaxW / 2 - logoPadding;
    const logoBoxX1 = this.logoX + this.logoMaxW / 2 + logoPadding;
    const logoBoxY0 = 0;
    const logoBoxY1 = this.logoY + this.logoMaxH / 2 + logoPadding;
    const logoBacking = this.add.graphics().setDepth(DEPTH.characters + 1);
    logoBacking.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.38, 0.38, 0, 0);
    logoBacking.fillRect(logoBoxX0, logoBoxY0, logoBoxX1 - logoBoxX0, logoBoxY1 - logoBoxY0);
    this.debugTrack("FONDO logoBacking (rectángulo oscuro tras el logo)", logoBacking);

    // Punto 1: "rosquillas flotando" — PLACEHOLDER (no hay un asset dedicado
    // de rosquilla/dona todavía, ver mensaje final de la fase con el tamaño
    // recomendado): reutiliza el mismo resplandor radial (circular, sin el
    // defecto de textura cuadrada). CORRECCIÓN D1 (puntos 1 y 4): depth
    // consolidado en `characters` (antes `background+1`, un valor suelto que
    // no venía de la jerarquía fija) y NUNCA en la "zona prohibida" del logo
    // (antes podían caer ahí, chocando con él).
    const count = D.floatingCount;
    const maxAttempts = 12;
    for (let i = 0; i < count; i++) {
      let startX = 0;
      let startY = 0;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        startX = Phaser.Math.Between(0, this.W);
        startY = Phaser.Math.Between(0, this.barTop);
        const insideLogoBox = startX >= logoBoxX0 && startX <= logoBoxX1 && startY >= logoBoxY0 && startY <= logoBoxY1;
        if (!insideLogoBox) break;
      }
      const size = Phaser.Math.Between(Math.round(this.H * 0.03), Math.round(this.H * 0.065));
      const donut = this.add
        .image(startX, startY, TEX.glow)
        .setDepth(DEPTH.characters)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(0)
        .setDisplaySize(size, size)
        .setTint(0xffd23f);
      const drift = Phaser.Math.Between(50, 110);
      const duration = Phaser.Math.Between(10000, 18000);
      const delay = Phaser.Math.Between(0, 6000);
      this.tweens.add({
        targets: donut,
        y: startY - drift,
        x: startX + Phaser.Math.Between(-50, 50),
        alpha: { from: 0, to: 0.35 },
        duration: duration / 2,
        delay,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }
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
    // En el fallback de ventana angosta no táctil, el panel de GANANCIA se
    // atornilla justo debajo (drawWinPanel): sus esquinas inferiores quedan
    // CUADRADAS para que el borde de la rejilla y el de ese panel se junten a
    // ras, sin el hueco en forma de lente que dejan dos esquinas redondeadas
    // enfrentadas. En MÓVIL real y en ESCRITORIO real no existe ese panel
    // pegado debajo (la GANANCIA es solo texto flotante — ver
    // buildControlsMobile / drawWinInfoDesktop): por eso ahí SÍ se redondean
    // las cuatro esquinas, como pide el marco "tipo tarjeta" de la referencia.
    const isNarrowFallback = !this.isMobile && this.portrait;
    const rBottom = isNarrowFallback ? 0 : r;
    const radius = { tl: r, tr: r, br: rBottom, bl: rBottom };

    // CORRECCIÓN 5 (punto 4, SOLO MÓVIL): panel en azul/morado profundo
    // translúcido (antes azul grisáceo) con degradado interior suave entre dos
    // tonos del mismo color, borde dorado más grueso (5-6px reales) con las
    // cuatro esquinas redondeadas, y un resplandor dorado sutil PEGADO por
    // dentro del borde (además del halo exterior que ya existía). Escritorio y
    // el fallback de ventana angosta no táctil conservan el panel claro de
    // siempre, sin tocar (rama `else` de abajo).
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

    // FASE 2 DESKTOP (punto 4): mismo lenguaje visual que el panel móvil
    // (azul/morado profundo + borde dorado + resplandor interior), con los
    // números propios de CONFIG_DESKTOP.frame. El fallback de ventana angosta
    // no táctil sigue con el panel claro de siempre (rama final, sin tocar).
    if (!this.portrait) {
      this.drawPanelDesktop(px, py, pw, ph, r, radius);
      return;
    }

    // FALLBACK de ventana angosta no táctil: SIN CAMBIOS.
    // Resplandor suave del color de acento (sin oscurecer, estilo caramelo).
    const glow = this.add.graphics().setDepth(-3);
    for (let i = 3; i >= 1; i--) {
      const gr = { tl: r + i * 6, tr: r + i * 6, br: rBottom ? r + i * 6 : 0, bl: rBottom ? r + i * 6 : 0 };
      glow.fillStyle(this.accent, 0.05);
      glow.fillRoundedRect(px - i * 8, py - i * 8, pw + i * 16, ph + i * 16, gr);
    }

    // Panel CLARO translúcido (como Sweet Bonanza): deja ver el fondo por detrás.
    const panel = this.add.graphics().setDepth(-2);
    panel.fillStyle(0xffffff, 0.12).fillRoundedRect(px, py, pw, ph, radius);
    const innerR = { tl: r - 3, tr: r - 3, br: Math.max(0, rBottom - 3), bl: Math.max(0, rBottom - 3) };
    panel.fillStyle(0xffffff, 0.06).fillRoundedRect(px + 5, py + 5, pw - 10, ph - 10, innerR);
    // Separadores verticales muy tenues entre rodillos.
    panel.lineStyle(2, 0xffffff, 0.1);
    for (let c = 1; c < this.cols; c++) {
      const x = this.gridX + c * this.size;
      panel.lineBetween(x, this.gridY, x, this.gridY + this.gridH);
    }

    // Borde en DEGRADADO continuo entre el acento y blanco (antes era punteado:
    // línea-espacio-línea; ahora es una sola franja que va fundiendo un color con
    // el otro alrededor de todo el panel, sin cortes).
    this.strokeGradientRoundedRect(px, py, pw, ph, radius);
  }

  // ====================================================================== //
  // MARCO DESKTOP (Fase 2, punto 4) — módulo aislado: solo se llama desde    //
  // drawPanel() cuando !isMobile && !portrait. Mismo lenguaje visual que el //
  // panel móvil (azul/morado profundo + borde dorado + resplandor interior),//
  // con los números propios de CONFIG_DESKTOP.frame (sin factor de escala:  //
  // Scale.RESIZE ya trabaja en px reales).                                 //
  // ====================================================================== //
  private drawPanelDesktop(
    px: number,
    py: number,
    pw: number,
    ph: number,
    r: number,
    radius: { tl: number; tr: number; br: number; bl: number }
  ) {
    const F = CONFIG_DESKTOP.frame;
    const DEPTH = CONFIG_DESKTOP.depth;
    const GOLD = F.borderColor;

    // AUDITORÍA/CORRECCIÓN D1 (punto 1): `frameFill` es NEGATIVO — el relleno
    // translúcido del marco (y su halo exterior) SIEMPRE detrás de los
    // símbolos (depth 0). Antes usaba `DEPTH.frame-2`/`-1` (8/9, POSITIVOS),
    // por encima de los símbolos — esa era la causa exacta del "velo azul"
    // lavando los símbolos (y, al estar tan alto en la escala, también se
    // notaba cerca de los controles de abajo).
    const glow = this.add.graphics().setDepth(DEPTH.frameFill - 1);
    for (let i = 3; i >= 1; i--) {
      const gr = { tl: r + i * 6, tr: r + i * 6, br: r + i * 6, bl: r + i * 6 };
      glow.fillStyle(GOLD, 0.05);
      glow.fillRoundedRect(px - i * 8, py - i * 8, pw + i * 16, ph + i * 16, gr);
    }
    this.debugTrack("MARCO halo exterior", glow);
    const panel = this.add.graphics().setDepth(DEPTH.frameFill);
    // Punto 4: ~75% de opacidad, degradado vertical sutil entre dos tonos del
    // mismo azul/morado (no un color plano).
    panel.fillGradientStyle(F.fillTop, F.fillTop, F.fillBottom, F.fillBottom, F.fillAlpha * 0.95, F.fillAlpha * 0.95, F.fillAlpha, F.fillAlpha);
    panel.fillRoundedRect(px, py, pw, ph, radius);
    const innerR = { tl: r - 3, tr: r - 3, br: Math.max(0, r - 3), bl: Math.max(0, r - 3) };
    panel.fillStyle(0xffffff, 0.04).fillRoundedRect(px + 5, py + 5, pw - 10, ph - 10, innerR);
    // Separadores de columna muy sutiles, dorados.
    panel.lineStyle(2, GOLD, 0.14);
    for (let c = 1; c < this.cols; c++) {
      const x = this.gridX + c * this.size;
      panel.lineBetween(x, this.gridY, x, this.gridY + this.gridH);
    }
    // Borde dorado 6-8px reales + resplandor interior sutil + brillo que
    // pulsa suavemente, igual que móvil.
    this.debugTrack("MARCO relleno translúcido", panel);
    const border = this.add.graphics().setDepth(DEPTH.frame);
    const th = F.borderWidthPx;
    border.lineStyle(th, GOLD, 1).strokeRoundedRect(px, py, pw, ph, radius);
    this.debugTrack("MARCO borde dorado", border);
    const innerGlow = this.add.graphics().setDepth(DEPTH.frame).setBlendMode(Phaser.BlendModes.ADD);
    const innerInset = th + 3;
    innerGlow.lineStyle(Math.max(4, th), GOLD, 0.18).strokeRoundedRect(
      px + innerInset, py + innerInset, pw - innerInset * 2, ph - innerInset * 2,
      { tl: Math.max(0, r - innerInset), tr: Math.max(0, r - innerInset), br: Math.max(0, r - innerInset), bl: Math.max(0, r - innerInset) }
    );
    this.debugTrack("MARCO resplandor interior", innerGlow);
    this.tweens.add({
      targets: [border, innerGlow],
      alpha: 0.5,
      duration: 1700,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  // ====================================================================== //
  // PERSONAJES DECORATIVOS DESKTOP (Fase 2, punto 2) — módulo aislado: solo  //
  // se llama cuando !isMobile && !portrait. PLACEHOLDER: el modelo de tema   //
  // actual no tiene un asset dedicado para "personaje decorativo" (Homer,   //
  // etc.) — solo fondo/logo/banners genéricos (ver constants.ts TEX) —, así  //
  // que se dibuja una silueta simple + etiqueta en vez de un sprite real,    //
  // por Regla 4 ("si falta un asset, usa un placeholder con nombre claro").  //
  // Tamaños recomendados para el asset real, en el mensaje final de la fase. //
  // En pantallas ~16:9 casi exactas el margen lateral es angosto a propósito //
  // (Fase 2 solo ensanchó lo necesario para dar cabida a esto en la mayoría  //
  // de monitores) y el personaje se omite si no entra holgado, en vez de     //
  // forzarlo apretado contra el marco.                                      //
  // ====================================================================== //
  private drawDesktopDecorCharacters() {
    const D = CONFIG_DESKTOP;
    if (!D.decorChar.enabled) return;
    const frameLeft = this.gridX - this.panelPad;
    const frameRight = this.gridX + this.gridW + this.panelPad;
    // CORRECCIÓN D2 (punto 4): estirado desde la rejilla hasta el FINAL de
    // la barra (antes solo cubría el alto de la rejilla — "por encima de la
    // barra" pedía que llegaran hasta ahí). Profundidad dedicada
    // (`decorChar`, entre `hudBar` y `hud`): se ve POR ENCIMA del fondo de
    // la barra (si no, el 88% de opacidad de la Corrección D2 punto 2 lo
    // tapa del todo) pero DEBAJO de sus botones — si el margen es angosto y
    // choca con el grupo izquierdo/derecho de la barra, el botón sigue
    // viéndose por delante, nunca al revés.
    const topY = this.gridY;
    const bottomY = this.barTop + this.footerH;
    const centerY = (topY + bottomY) / 2;
    const h = bottomY - topY;

    const drawSide = (bandX0: number, bandX1: number, name: string) => {
      const marginW = bandX1 - bandX0;
      if (marginW < 60) return; // sin sitio útil (pantalla ~16:9 casi exacta) — se omite, no se aprieta
      // Nunca se sale de [bandX0, bandX1] (el margen REAL fuera del marco) —
      // "que no queden cortados bruscamente por el borde de la pantalla":
      // bandX0 es `this.contentX` (o `frameRight`), nunca el borde físico de
      // la ventana salvo en ultra-wide, donde sí hay de sobra.
      const w = Math.min(marginW * D.decorChar.widthPct, marginW - 12);
      const cx = (bandX0 + bandX1) / 2;
      const g = this.add.graphics().setDepth(D.depth.decorChar);
      g.fillStyle(0x000000, 0.22).fillRoundedRect(cx - w / 2, centerY - h / 2, w, h, Math.round(w * 0.3));
      g.lineStyle(2, 0xffffff, 0.25).strokeRoundedRect(cx - w / 2, centerY - h / 2, w, h, Math.round(w * 0.3));
      this.debugTrack(`${name} caja`, g);
      const placeholderTxt = this.add
        .text(cx, centerY, "PERSONAJE\n(placeholder)", {
          fontFamily: "Arial, sans-serif",
          fontSize: `${Math.max(12, Math.round(w * 0.09))}px`,
          align: "center",
          color: "#ffffff",
        })
        .setOrigin(0.5)
        .setAlpha(0.4)
        .setDepth(D.depth.decorChar + 1);
      this.debugTrack(`${name} texto`, placeholderTxt);
      this.debugRegisterBox(name, cx, centerY, w, h);
    };
    drawSide(this.contentX, frameLeft, "PERSONAJE IZQ");
    drawSide(frameRight, this.contentX + this.contentW, "PERSONAJE DER");
  }

  // Panel de GANANCIA (solo móvil): mismo estilo que el panel de la rejilla,
  // ADOSADO justo a su borde inferior — se lee como una sola cápsula continua,
  // no como un texto suelto flotando con un hueco encima. Solo redondea las
  // esquinas INFERIORES (las superiores quedan a ras del panel de la rejilla,
  // que ahora también tiene las suyas cuadradas) y NO traza el lado superior:
  // ese borde ya lo pintó el panel de arriba, justo encima.
  private drawWinPanel() {
    const pad = this.panelPad;
    const r = Math.round(this.size * 0.22);
    const px = this.gridX - pad;
    const py = this.gridY + this.gridH + pad;
    const pw = this.gridW + pad * 2;
    const ph = this.winPanelH;
    const radius = { tl: 0, tr: 0, br: r, bl: r };

    const panel = this.add.graphics().setDepth(-2);
    panel.fillStyle(0xffffff, 0.12).fillRoundedRect(px, py, pw, ph, radius);
    panel.fillStyle(0xffffff, 0.06).fillRoundedRect(px + 5, py + 5, pw - 10, ph - 10, {
      tl: 0, tr: 0, br: Math.max(0, r - 3), bl: Math.max(0, r - 3),
    });
    this.strokeGradientRoundedRect(px, py, pw, ph, radius, { skipTop: true });
  }

  private lerpColor(a: number, b: number, t: number): number {
    const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
    const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
    const r = Math.round(ar + (br - ar) * t);
    const g = Math.round(ag + (bg - ag) * t);
    const bl = Math.round(ab + (bb - ab) * t);
    return (r << 16) | (g << 8) | bl;
  }

  // Traza un rectángulo redondeado con el borde en DEGRADADO continuo (acento <->
  // blanco). Graphics de Phaser no sabe pintar un trazo con degradado real, así
  // que se aproxima con muchos segmentos cortos, cada uno con el color
  // interpolado según su posición en el perímetro (esquinas incluidas).
  // `radius` admite un número (4 esquinas iguales) o {tl,tr,br,bl} para redondear
  // solo algunas (p. ej. el panel de GANANCIA solo redondea las inferiores, para
  // que las superiores queden a ras del borde de la rejilla, sin costura).
  // `skipTop`: no traza el lado superior (ni sus esquinas) — se usa en el panel
  // de GANANCIA porque ese borde ya lo pinta el borde inferior de la rejilla
  // justo encima; dibujarlo dos veces duplicaba la línea en la costura.
  private strokeGradientRoundedRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radius: number | { tl: number; tr: number; br: number; bl: number },
    opts: { skipTop?: boolean; depth?: number } = {}
  ) {
    const { tl, tr, br, bl } =
      typeof radius === "number" ? { tl: radius, tr: radius, br: radius, bl: radius } : radius;
    const g = this.add.graphics().setDepth(opts.depth ?? -1);
    const th = Math.max(4, Math.round(this.size * 0.05));
    const P = Math.PI;

    const points: { x: number; y: number }[] = [];
    const addLine = (x1: number, y1: number, x2: number, y2: number) => {
      const n = Math.max(4, Math.round(Math.hypot(x2 - x1, y2 - y1) / 5));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        points.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t });
      }
    };
    const addArc = (cx: number, cy: number, rad: number, a0: number, a1: number) => {
      if (rad <= 0) return;
      const n = Math.max(6, Math.round((rad * Math.abs(a1 - a0)) / 5));
      for (let i = 0; i <= n; i++) {
        const a = a0 + (a1 - a0) * (i / n);
        points.push({ x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad });
      }
    };
    // Recorrido en sentido horario. Si `skipTop`, arranca en la esquina superior
    // derecha (sin lado ni esquinas de arriba) y termina en la superior izquierda.
    if (!opts.skipTop) {
      addLine(x + tl, y, x + w - tr, y);
      addArc(x + w - tr, y + tr, tr, -P / 2, 0);
    }
    addLine(x + w, y + tr, x + w, y + h - br);
    addArc(x + w - br, y + h - br, br, 0, P / 2);
    addLine(x + w - br, y + h, x + bl, y + h);
    addArc(x + bl, y + h - bl, bl, P / 2, P);
    addLine(x, y + h - bl, x, y + tl);
    if (!opts.skipTop) addArc(x + tl, y + tl, tl, P, P * 1.5);

    const n = points.length;
    for (let i = 0; i < n - 1; i++) {
      const phase = (i / n) * 2; // 0..2: sube acento->blanco y baja blanco->acento
      const t = phase <= 1 ? phase : 2 - phase;
      g.lineStyle(th, this.lerpColor(this.accent, 0xffffff, t), 1);
      g.lineBetween(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);
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
    // SOLO MÓVIL (Fases 2 y 4): sin cuadro gris por celda + sombra/brillo en
    // el símbolo. FASE 2 DESKTOP (punto 5/6): escritorio real adopta el MISMO
    // tratamiento visual (flatCells/symbolFx) — ya no pasa por `this.isMobile`
    // solo, sino por "¿es un modo con HUD propio?" (móvil o escritorio real),
    // dejando afuera ÚNICAMENTE el fallback de ventana angosta no táctil
    // (portrait && !isMobile), que conserva el cuadro gris de siempre. El
    // flag `mobile` (física de giro: turbo/anticipación/aceleración) NO
    // cambia — sigue siendo exclusivo de móvil real.
    const useFloatingSymbols = this.isMobile || !this.portrait;
    for (let c = 0; c < this.cols; c++) {
      this.reels.push(
        new Reel(
          this,
          this.gridX + c * this.size,
          this.gridY,
          c,
          this.rows,
          this.size,
          pool,
          useFloatingSymbols,
          useFloatingSymbols,
          this.isMobile,
          // CORRECCIÓN 4 (punto 3): alto de celda — en desktop this.cellH ===
          // this.size siempre (celda cuadrada, sin cambios); en móvil puede
          // ser distinto (celdas 4:5, ver computeLayoutMobile).
          this.cellH
        )
      );
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

  // -------------------------------------------------------------------- //
  // Barra de controles inferior (estilo Pragmatic/Playtech): SALDO ·      //
  // APUESTA (con −/+) · GANANCIA, y el botón de girar al centro.          //
  // -------------------------------------------------------------------- //
  // Imagen "cover" (puede recortar, nunca deja huecos): para banners que deben
  // cubrir una franja entera de borde a borde, a diferencia de fitImage (contain).
  private coverImage(img: Phaser.GameObjects.Image, w: number, h: number) {
    const t = img.texture.getSourceImage();
    img.setScale(Math.max(w / t.width, h / t.height));
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

  private buildControls() {
    const barH = this.footerH;
    const P = this.portrait;

    // Banner de fondo de la barra inferior (cubre toda la franja de controles, por
    // DEBAJO de botones/texto). Opcional: si el tema no lo subió, no se dibuja nada.
    if (this.textures.exists(TEX.footerBanner)) {
      const fb = this.add.image(this.W / 2, this.barTop + barH / 2, TEX.footerBanner).setDepth(1);
      this.coverImage(fb, this.W, barH);
    }
    const labelSize = Math.round(Math.min(this.W * (P ? 0.034 : 0.026), P ? 18 : 19));
    const valueSize = Math.round(Math.min(this.W * (P ? 0.055 : 0.043), P ? 33 : 36));

    const spinMax = P
      ? Math.min(barH * 0.5, this.W * 0.3, 150)
      : Math.min(barH * 0.86, 130, this.W * 0.15);
    const btnR = Math.min(spinMax * 0.32, P ? 32 : 26);
    const tR = Math.min(barH * (P ? 0.09 : 0.15), P ? 25 : 22);
    // Alto real de la caja de CRÉDITO/APUESTA (se necesita YA para encadenar las
    // filas del footer sin que se pisen entre sí — ver más abajo).
    const statBoxH = (labelSize + valueSize) * 2.6;

    // Posiciones según orientación (móvil = apilado; escritorio = giro a la derecha).
    let spinX: number, spinY: number, minusX: number, plusX: number;
    let creditX: number, creditY: number, betX: number, betY: number;
    let autoX: number, autoY: number, turboX: number, turboY: number;
    let musicX: number, musicY: number;
    let infoX = 0, infoY = 0;

    if (P) {
      // MÓVIL: de nuevo por fracción de `barH` (el encadenado de la vez pasada se
      // veía mal) — giro con −/+ un poco más abajo/centrado, crédito/apuesta
      // debajo, iconos pegados al fondo.
      spinX = this.W / 2;
      spinY = this.barTop + barH * 0.32;
      minusX = spinX - spinMax / 2 - 18 - btnR;
      plusX = spinX + spinMax / 2 + 18 + btnR;
      creditX = this.W * 0.28; betX = this.W * 0.72;
      creditY = betY = this.barTop + barH * 0.62;
      const iconY = this.barTop + barH * 0.86;
      // Iconos como fila centrada horizontalmente: se reparten simétricamente
      // alrededor del centro según CUÁNTOS vayan a dibujarse de verdad (si el tema
      // no subió música, el botón no se crea — ver setupMusic — y reservarle un
      // hueco igual dejaba el trío info/auto/turbo descentrado hacia la izquierda).
      const hasMusicIcon = this.textures.exists(TEX.musicOn) && this.textures.exists(TEX.musicOff);
      const iconCount = hasMusicIcon ? 4 : 3;
      const iconGap = tR * 2.7;
      const iconSlotX = (i: number) => this.W / 2 + iconGap * (i - (iconCount - 1) / 2);
      infoX = iconSlotX(0);
      autoX = iconSlotX(1);
      turboX = iconSlotX(2);
      musicX = hasMusicIcon ? iconSlotX(3) : -9999; // fuera de pantalla: setupMusic no lo crea igual
      infoY = turboY = autoY = musicY = iconY;
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
      infoX = Math.max(tR + 6, turboX - tR * 2 - 18);
      autoY = turboY = infoY = spinY;
      creditX = Math.max(96, this.W * 0.1); creditY = this.barTop + barH * 0.34;
      betX = creditX; betY = this.barTop + barH * 0.72;
      musicX = Math.max(tR + 10, this.W * 0.03); musicY = spinY;
    }

    // Fondos decorativos detrás de CRÉDITO/APUESTA (opcionales). Se ESTIRAN a
    // propósito (ver stretchImage): si se usara fitImage, un banner subido chico
    // nunca crece más allá de su tamaño nativo y se ve enano sin importar cuánto
    // midan statBoxW/H.
    const statBoxW = Math.min(this.W * 0.38, 290);
    if (this.textures.exists(TEX.balanceBanner)) {
      const bb = this.add.image(creditX, creditY, TEX.balanceBanner).setDepth(6);
      this.stretchImage(bb, statBoxW, statBoxH);
    }
    if (this.textures.exists(TEX.betBanner)) {
      const btb = this.add.image(betX, betY, TEX.betBanner).setDepth(6);
      this.stretchImage(btb, statBoxW, statBoxH);
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
    // GANANCIA: en el fallback de ventana angosta no táctil, arriba (franja
    // del logo); en móvil, pegada bajo la rejilla (ver buildControlsMobile).
    // En ESCRITORIO real, ver drawWinInfoDesktop() (Fase 2, punto 7) —
    // reemplaza el banner amarillo por texto con degradado dorado. Va en un
    // contenedor para OCULTARLA mientras se muestra el banner de victoria.
    if (!P) {
      this.drawWinInfoDesktop();
    } else {
      const winY = this.winRowY;
      if (this.textures.exists(TEX.topbarBanner)) {
        // depth 4: por DEBAJO de winGfx/prizeBanner (5) y winText/GANANCIA (6), si no
        // tapa el texto del premio (ya pasó: quedaba por encima al añadirse después).
        const tb = this.add.image(this.W / 2, winY, TEX.topbarBanner).setDepth(4);
        // El panel de GANANCIA tiene un ancho y alto FIJOS (el mismo cápsula
        // adosada a la rejilla — ver drawWinPanel): el banner subido por el casino
        // debe ocupar TODO ese espacio horizontal, estirado si hace falta.
        this.stretchImage(tb, this.gridW + this.panelPad * 2, this.winPanelH);
      }
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
    }

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

    // INFO (combinaciones ganadoras): abre el modal de paytable, que vive en React.
    this.makeToggle(infoX, infoY, "i", "INFO", tR, () => this.runtime.onShowPaytable?.(), TEX.infoBtn, TEX.infoBtn);

    // Música.
    this.musicR = tR;
    this.musicX = musicX;
    this.musicY = musicY;
  }

  // ====================================================================== //
  // GANANCIA DESKTOP (Fase 2, punto 7) — módulo aislado: solo se llama desde //
  // buildControls() cuando !portrait (escritorio real). Reemplaza el banner //
  // amarillo con imagen por texto con degradado dorado (mismo tratamiento   //
  // que el logo/GANANCIA móvil) — etiqueta chica arriba, monto grande       //
  // abajo, centrado entre el marco y la barra de control. Asigna            //
  // this.winValue/this.winGroup, los mismos campos que usa TODO el código   //
  // compartido de celebración de victorias (rollUpText, etc.) — no se tocó  //
  // nada de esa lógica, solo cómo se dibuja el texto.                       //
  // ====================================================================== //
  private drawWinInfoDesktop() {
    const winY = this.topInfoY;
    // MISMA fórmula que reservó el espacio en computeLayoutDesktop() —
    // winInfoMetrics() es la única fuente de verdad para estos tamaños.
    const { labelSize, valueSize, topOffset, bottomOffset } = this.winInfoMetrics(this.gridW);
    const gLabel = this.goldGradientText(
      this.W / 2, winY - topOffset + labelSize / 2, "GANANCIA", labelSize,
      "#3d230a", ["#fff6c8", "#ffd23f", "#b5790a"], Math.max(2, Math.round(labelSize * 0.16))
    );
    this.winValue = this.goldGradientText(
      this.W / 2, winY + bottomOffset - valueSize / 2, this.money(0), valueSize,
      "#3d230a", ["#fff6c8", "#ffd23f", "#b5790a"], Math.max(3, Math.round(valueSize * 0.12))
    );
    this.winGroup = this.add.container(0, 0, [gLabel, this.winValue]).setDepth(CONFIG_DESKTOP.depth.hud);
    this.debugTrack("GANANCIA etiqueta", gLabel);
    this.debugTrack("GANANCIA monto", this.winValue);
    this.debugTrack("GANANCIA contenedor", this.winGroup);
    this.debugRegisterBox("GANANCIA (texto)", this.W / 2, winY, this.gridW * 0.6, topOffset + bottomOffset);
  }

  // ====================================================================== //
  // EXTRAS DESKTOP (Fase 1) — botón de pantalla completa + tecla F + debug  //
  // de zonas. Aislado: solo se llama cuando !isMobile && !portrait. No      //
  // toca buildControls() ni ningún dibujado existente.                     //
  // ====================================================================== //
  private buildDesktopExtras() {
    const D = CONFIG_DESKTOP;

    // ---- Pantalla completa: SOLO la tecla F — CORRECCIÓN D1 (punto 6): el
    // BOTÓN se quitó de aquí (vivía dibujado en el canvas, con su propio
    // margen de 16px, desalineado del header DOM de atrás/salir). Ahora el
    // botón vive en el MISMO header DOM que esos dos (ver PlayPage/
    // EmbedPage.tsx — SlotGameCanvas les entrega la función real por
    // `onFullscreenReady`), así los tres comparten exactamente el mismo
    // margen/fila sin ningún truco de alineación cruzada DOM-vs-canvas.
    // F11 es un atajo nativo del navegador, fuera del control de la página;
    // igual dispara un resize real que la escena ya recalcula (ver onResize).
    if (D.fullscreen.enabled) {
      this.input.keyboard?.on(`keydown-${D.fullscreen.keyCode}`, () => this.toggleDesktopFullscreen());
    }

    // ---- Debug: bounding boxes de las zonas principales de escritorio
    // (Fase 1, punto 3/4) — mismo mecanismo que móvil (CONFIG_DESKTOP.debug.enabled).
    // "ZONA SEGURA" y "BARRA CONTROL" (Fase 1) se quitaron de aquí: eran cajas
    // GENÉRICAS que ahora encierran a todos los elementos reales que se
    // registran por separado en drawWinInfoDesktop()/buildControlsDesktop()
    // (Fases 2 y 3) — dejarlas generaba solapes "falsos" contra TODO lo de
    // adentro, sin ninguna señal útil. LOGO y MARCO RODILLOS sí se quedan:
    // sirven para detectar si el logo choca con el marco, un caso real.
    this.debugRegisterBox("LOGO", this.logoX, this.logoY, this.logoMaxW, this.logoMaxH);
    this.debugRegisterBox("MARCO RODILLOS", this.gridX + this.gridW / 2, this.gridY + this.gridH / 2, this.gridW + this.panelPad * 2, this.gridH + this.panelPad * 2);
    this.debugCheckOverlaps();
    // DIAGNÓSTICO D1b (PASO 2): tabla completa de objetos reales del HUD de
    // escritorio — ver debugDumpObjects(). Al final de buildDesktopExtras()
    // porque corre DESPUÉS de drawBackground/drawPanel/drawDesktopDecorCharacters/
    // buildReels/drawTitle/drawBanner/buildControlsDesktop, es decir, cuando
    // YA existen todos los objetos que se quieren volcar.
    this.debugDumpObjects();
  }

  private toggleDesktopFullscreen() {
    this.scale.toggleFullscreen();
  }

  // ====================================================================== //
  // ÍCONO CIRCULAR DESKTOP (Fase 3, punto 5) — mismo lenguaje visual que      //
  // mobileToggleIcon (disco glossy + glifo blanco), pero SIN la dependencia  //
  // de CONFIG_MOBILE.layout.showIconCaptions/designScaleFactor (conceptos    //
  // que no existen en escritorio, que usa Scale.RESIZE). En vez de una       //
  // etiqueta siempre visible, muestra un TOOLTIP al pasar el mouse (la       //
  // alternativa que pide el punto 5 — un mouse es, por definición, algo que  //
  // solo existe en escritorio).                                             //
  // ====================================================================== //
  private desktopToggleIcon(
    x: number,
    y: number,
    r: number,
    glyph: string,
    tooltip: string,
    onClick?: () => void,
    stub = false
  ): Toggle {
    const DEPTH = CONFIG_DESKTOP.depth;
    const chip = this.mobileRoundChip(x, y, r, 0x0b0f1a, 0.45, 0xffffff, 0.7);
    const glyphTxt = this.add
      .text(x, y - 1, glyph, {
        fontFamily: MOBILE_FONT,
        fontSize: `${Math.round(r * 0.95)}px`,
        fontStyle: "700",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setShadow(0, 2, "#000000", 3, true, true)
      .setDepth(DEPTH.hud + 1);
    const tip = this.add
      .text(x, y - r - 10, tooltip, {
        fontFamily: MOBILE_FONT,
        fontSize: "13px",
        fontStyle: "700",
        color: "#ffffff",
        backgroundColor: "#0b0f1ae0",
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5, 1)
      .setAlpha(0)
      .setDepth(DEPTH.overlays);
    // FASE 4 DESKTOP (punto 1): hover — escala leve (1.06) en el disco+glifo
    // + un halo ADD suave, además del tooltip (punto 3). "Presionado" sigue
    // siendo mobilePressFeedback de siempre (no se duplica).
    const hoverHalo = this.add
      .image(x, y, TEX.glow)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xffffff)
      .setDisplaySize(r * 2.5, r * 2.5)
      .setAlpha(0)
      .setDepth(DEPTH.hud);
    this.debugTrack(`${tooltip} chip`, chip);
    this.debugTrack(`${tooltip} glifo`, glyphTxt);
    this.debugTrack(`${tooltip} halo-hover (TEX.glow)`, hoverHalo);
    const hoverIn = () => {
      this.tweens.add({ targets: [chip, glyphTxt], scale: 1.06, duration: 140, ease: "Sine.easeOut" });
      this.tweens.add({ targets: tip, alpha: 1, duration: 120 });
      this.tweens.add({ targets: hoverHalo, alpha: 0.3, duration: 120 });
    };
    const hoverOut = () => {
      this.tweens.add({ targets: [chip, glyphTxt], scale: 1, duration: 160, ease: "Sine.easeOut" });
      this.tweens.add({ targets: tip, alpha: 0, duration: 120 });
      this.tweens.add({ targets: hoverHalo, alpha: 0, duration: 120 });
    };
    if (!stub && onClick) {
      this.add
        .zone(x, y, r * 2.2, r * 2.2)
        .setInteractive({ useHandCursor: true })
        .setDepth(DEPTH.hud + 2)
        .on("pointerover", hoverIn)
        .on("pointerout", hoverOut)
        .on("pointerdown", () => {
          this.mobilePressFeedback(x, y, r, [glyphTxt]);
          onClick();
        });
    } else {
      // Stub (p. ej. MENÚ, todavía sin funcionalidad): el tooltip y el hover
      // SÍ se muestran al pasar el mouse (confirma qué es y que "se ve
      // activo"), pero no reacciona al clic.
      this.add
        .zone(x, y, r * 2.2, r * 2.2)
        .setInteractive({ useHandCursor: false })
        .setDepth(DEPTH.hud + 2)
        .on("pointerover", hoverIn)
        .on("pointerout", hoverOut);
    }
    const setActive = (on: boolean) => {
      chip.clear();
      chip.fillStyle(0x0b0f1a, on ? 0.65 : 0.45).fillCircle(0, 0, r);
      chip.lineStyle(Math.max(2, Math.round(r * 0.06)), on ? this.accent : 0xffffff, on ? 1 : 0.7).strokeCircle(0, 0, r);
      chip.lineStyle(Math.max(1.5, r * 0.03), 0xffffff, 0.35);
      chip.beginPath();
      chip.arc(0, 0, r * 0.86, Math.PI * 1.08, Math.PI * 1.92, false);
      chip.strokePath();
      glyphTxt.setColor(on ? this.accentHex : "#ffffff");
    };
    this.debugRegisterBox(tooltip, x, y, r * 2, r * 2);
    return { setActive };
  }

  // ====================================================================== //
  // BARRA DE CONTROL DESKTOP (Fase 3) — módulo aislado: solo se llama cuando //
  // !isMobile && !portrait. Mismo lenguaje visual que buildControlsMobile    //
  // (reutiliza mobileRoundChip/mobileGlyphButton/mobilePressFeedback/        //
  // mobileInfoPill — son dibujo genérico, sin nada específico de móvil       //
  // adentro) con layout HORIZONTAL propio: izquierda info/menú/sonido,       //
  // centro-izquierda CRÉDITO/APUESTA, centro texto de turbo, derecha         //
  // auto/turbo/−/SPIN/+. Conecta a la MISMA lógica de siempre (onSpin/       //
  // changeBet/toggleAuto/toggleTurbo/onShowPaytable/toggleMusic) — nada de   //
  // eso se modificó.                                                        //
  // ====================================================================== //
  private buildControlsDesktop() {
    const CB = CONFIG_DESKTOP.controlBar;
    const C = CONFIG_DESKTOP.controls;
    const DEPTH = CONFIG_DESKTOP.depth;
    const W = this.W;
    const barTop = this.barTop;
    const barH = this.footerH;
    this.debugBoxes = [];

    // ---- GANANCIA (Fase 2, punto 7) — se construye junto con el resto del
    // HUD de escritorio, ya que antes vivía dentro de buildControls().
    this.drawWinInfoDesktop();

    // ---- Fondo de la barra (punto 1): a TODO el ancho de la VENTANA real,
    // anclado al borde real inferior (this.H: en Scale.RESIZE YA es el real,
    // a diferencia de móvil no hace falta ningún truco de letterbox). SIN
    // esquinas redondeadas — es un borde de pantalla, no un panel flotante
    // como el de los rodillos, así que no tiene sentido recortarle las
    // puntas justo en el borde físico del monitor.
    const bg = this.add.graphics().setDepth(DEPTH.hudBar);
    bg.fillGradientStyle(CB.fillTop, CB.fillTop, CB.fillBottom, CB.fillBottom, CB.fillAlpha, CB.fillAlpha, CB.fillAlpha, CB.fillAlpha);
    bg.fillRect(0, barTop, W, barH);
    bg.fillStyle(CB.topBorderColor, CB.topBorderAlpha).fillRect(0, barTop, W, CB.topBorderWidthPx);
    this.debugTrack("BARRA fondo", bg);

    // ---- Medidas compartidas, todas en px REALES (Scale.RESIZE) ----------
    const sideMargin = Math.max(16, this.contentW * C.sideMarginPct);
    // CORRECCIÓN D2 (punto 1): los 3 grupos ya no se reparten en TODO el
    // ancho de la zona segura — viven dentro de un contenedor de ancho
    // máximo ~1500px, CENTRADO, para que no se dispersen en monitores
    // anchos (antes el hueco entre pastillas y la zona derecha crecía sin
    // límite en 1920x1080+, dejando todo "flotando" muy separado).
    const barContentW = Math.min(C.maxContentW, this.contentW - sideMargin * 2);
    const barContentX0 = this.contentX + (this.contentW - barContentW) / 2;
    // NOTA: a propósito NO se registra un debugBox para este contenedor —
    // encerraría a TODO lo de adentro y generaría solapes "falsos" contra
    // cada elemento (la misma razón por la que se quitaron "ZONA SEGURA"/
    // "BARRA CONTROL" en la Corrección D1). Sus límites van en la tabla
    // final de la respuesta, no acá.
    const iconR = Math.max(C.iconMinR, barH * C.iconRPct);
    const btnR = Math.max(C.betBtnMinR, barH * C.betBtnRPct); // mínimo ~52px de diámetro, mismo piso que móvil
    const spinR = Math.min(barH * C.spinRPct, this.contentW * C.spinMaxContentWPct);
    const pillH = barH * C.pillHPct;
    const pillW = Math.min(this.contentW * C.pillWPct, C.pillMaxW);
    const pillGap = this.contentW * C.pillGapPct;
    const rowY = barTop + barH * 0.58; // fila principal (todo salvo SPIN, que sobresale arriba)
    // Punto 5: "sobresale ~30% por encima de la barra" — el 30% del
    // DIÁMETRO del SPIN queda por encima de `barTop`.
    const spinY = barTop + spinR * (1 - 2 * C.spinProtrudePct);

    // ---- Posiciones X de los 3 grupos — TODAS calculadas antes de dibujar
    // nada, porque el grupo CENTRO (punto 1) necesita saber dónde terminan
    // los otros dos para centrarse en el hueco que REALMENTE queda entre
    // ellos (centrarlo en el punto medio del CONTENEDOR, sin más, no
    // garantiza nada si el grupo derecho — SPIN incluido — es ancho: se
    // confirmó por cálculo que en 1920x1080 el grupo centro invadía 116px
    // del grupo derecho). ------------------------------------------------
    const iconGap = iconR * 2.4;
    // Izquierda: INFO, MENÚ, SONIDO — alineada al borde izquierdo del contenedor.
    const leftX0 = barContentX0;
    const infoX = leftX0 + iconR;
    const menuX = infoX + iconGap;
    const soundX = menuX + iconGap;
    // Derecha: AUTO, TURBO, −, SPIN, + — alineada al borde derecho del
    // contenedor. `spinSeparationPx` (nuevo, dedicado) separa el SPIN de
    // −/+ para que no se pisen — independiente de `pillGap`, que es para
    // otra cosa.
    const rightX1 = barContentX0 + barContentW;
    const plusX = rightX1 - btnR;
    const spinGap = spinR + btnR + C.spinSeparationPx;
    const spinX = plusX - btnR - spinGap;
    const minusX = spinX - spinGap;
    const turboX = minusX - btnR - iconGap;
    const autoX = turboX - iconGap;
    // Centro: CRÉDITO/APUESTA — centradas en el HUECO real entre los otros
    // dos grupos (no en el centro geométrico del contenedor completo).
    const leftGroupEnd = soundX + iconR;
    const rightGroupStart = autoX - iconR;
    const centerGapX = (leftGroupEnd + rightGroupStart) / 2;
    const creditX = centerGapX - pillGap / 2 - pillW / 2;
    const betX = centerGapX + pillGap / 2 + pillW / 2;

    // ---- Dibuja los 3 grupos -----------------------------------------
    this.desktopToggleIcon(infoX, rowY, iconR, "i", "INFO", () => this.runtime.onShowPaytable?.());
    // MENÚ: mismo criterio que móvil — visible y con el mismo aspecto
    // "activo" que los demás, pero sin funcionalidad todavía (stub).
    this.desktopToggleIcon(menuX, rowY, iconR, "≡", "MENÚ", undefined, true);
    this.musicToggleDesktop = this.desktopToggleIcon(soundX, rowY, iconR, "♪", "SONIDO", () => this.toggleMusic());
    this.musicToggleDesktop.setActive(!this.musicMuted);

    const credit = this.mobileInfoPill(creditX, rowY, pillW, pillH, "CRÉDITO", this.money(this.balance), ["#2be28a", "#0a6b3f"]);
    this.balanceValue = credit.valueText;
    this.creditPill = credit;
    const bet = this.mobileInfoPill(betX, rowY, pillW, pillH, "APUESTA", this.money(this.bet), ["#ffc93f", "#a85d00"]);
    this.betValue = bet.valueText;
    this.betPill = bet;
    this.debugTrack("CRÉDITO (pastilla, contenedor completo)", credit.cont);
    this.debugTrack("APUESTA (pastilla, contenedor completo)", bet.cont);
    this.debugRegisterBox("CRÉDITO", creditX, rowY, pillW, pillH);
    this.debugRegisterBox("APUESTA", betX, rowY, pillW, pillH);

    this.autoToggle = this.desktopToggleIcon(autoX, rowY, iconR, "∞", "AUTO", () => this.toggleAuto());
    this.turboToggle = this.desktopToggleIcon(turboX, rowY, iconR, "⚡", "TURBO", () => this.toggleTurbo());
    this.turboToggle.setActive(this.turbo);

    // SPIN: anillo dorado + resplandor ADD + pulso lento en reposo — mismo
    // recetario que móvil (CORRECCIÓN 4, punto 5). CORRECCIÓN D1 (punto 3):
    // 2.2x en vez de 2.6x — más chico, menos "bloque" (ver también el margen
    // agregado a la textura en PreloadScene). SOLO este, el de móvil (misma
    // receta, otro lugar del archivo) no se tocó.
    const spinGlow = this.add
      .image(spinX, spinY, TEX.glow)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xffd23f)
      .setDisplaySize(spinR * 2.2, spinR * 2.2)
      .setAlpha(0.4)
      .setDepth(DEPTH.hud - 1);
    this.tweens.add({ targets: spinGlow, alpha: 0.7, duration: 1500, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    this.debugTrack("SPIN resplandor (TEX.glow)", spinGlow);
    this.spinChip = this.mobileRoundChip(spinX, spinY, spinR, 0x0b0f1a, 0.55, 0xffffff, 0.85);
    this.debugTrack("SPIN disco (mobileRoundChip)", this.spinChip);
    const spinRing = this.add.graphics().setDepth(DEPTH.hud).setPosition(spinX, spinY);
    spinRing.lineStyle(Math.max(3, Math.round(spinR * 0.05)), 0xffd23f, 0.95).strokeCircle(0, 0, spinR * 1.06);
    const spinIdlePulse = this.tweens.add({
      targets: [this.spinChip, spinRing],
      scale: 1.045,
      duration: 1800,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
    this.button = this.add
      .image(spinX, spinY, TEX.transparentPixel)
      .setDisplaySize(spinR * 2, spinR * 2)
      .setDepth(DEPTH.hud + 2)
      .setInteractive({ useHandCursor: true });
    this.buttonLabel = this.add
      .text(spinX, spinY, "⟳", {
        fontFamily: MOBILE_FONT,
        fontSize: `${Math.round(spinR * 1.1)}px`,
        fontStyle: "700",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setShadow(0, 2, "#000000", 6, true, true)
      .setDepth(DEPTH.hud + 3);
    this.debugTrack("SPIN anillo", spinRing);
    this.debugTrack("SPIN zona táctil (invisible)", this.button);
    this.debugTrack("SPIN glifo ⟳", this.buttonLabel);
    this.button.on("pointerdown", () => {
      this.mobilePressFeedback(spinX, spinY, spinR, [this.buttonLabel]);
      this.tweens.add({ targets: this.buttonLabel, angle: this.buttonLabel.angle + 360, duration: 500, ease: "Cubic.easeOut" });
      this.onSpin();
    });
    // FASE 4 DESKTOP (punto 1): hover — escala leve en todo el conjunto del
    // SPIN (disco+anillo+glifo) + el resplandor ADD se aviva un poco más.
    // `spinChip`/`spinRing` (vía spinIdlePulse) y `buttonLabel` (vía
    // this.pulse) YA tienen un tween de `scale` corriendo en bucle (el pulso
    // de reposo) — animar `scale` DE NUEVO encima sin quitarlo primero sería
    // el mismo bug de "dos tweens peleando por la misma propiedad" que ya se
    // cazó antes en el fade de changeBet() en móvil. Se los QUITA al entrar
    // el mouse y se recrean al salir (no al revés: `.resume()` seguiría
    // desde su posición interna pausada, no desde el 1.0 real al que se
    // animó el hover, y pegaría un salto visible). Si el botón está
    // deshabilitado (girando), el hover no hace nada — no tiene sentido
    // "reactivar" el pulso de un botón que sigue girando.
    this.button.on("pointerover", () => {
      if (this.busy) return;
      this.pulse?.remove();
      this.spinIdlePulse?.remove();
      this.tweens.add({ targets: [this.spinChip, spinRing, this.buttonLabel], scale: 1.06, duration: 140, ease: "Sine.easeOut" });
      this.tweens.add({ targets: spinGlow, alpha: 0.85, duration: 140 });
    });
    this.button.on("pointerout", () => {
      if (this.busy) return;
      this.tweens.add({
        targets: [this.spinChip, spinRing, this.buttonLabel],
        scale: 1,
        duration: 160,
        ease: "Sine.easeOut",
        onComplete: () => {
          this.spinIdlePulse = this.tweens.add({
            targets: [this.spinChip, spinRing], scale: 1.045, duration: 1800, yoyo: true, repeat: -1, ease: "Sine.easeInOut",
          });
          this.pulse = this.tweens.add({
            targets: this.buttonLabel, scale: 1.08, duration: 750, yoyo: true, repeat: -1, ease: "Sine.easeInOut",
          });
        },
      });
      this.tweens.add({ targets: spinGlow, alpha: 0.4, duration: 160 });
    });
    this.pulse = this.tweens.add({
      targets: this.buttonLabel,
      scale: 1.08,
      duration: 750,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
    this.spinIdlePulse = spinIdlePulse;
    this.debugRegisterBox("SPIN", spinX, spinY, spinR * 2.2, spinR * 2.2);

    // −/+: discos glossy + glifo (reemplaza la cabeza/el "+" de Bart del tema
    // — punto 5 pide el mismo estilo circular glossy que el resto, no
    // imágenes del tema aquí). Sin pulso de reposo propio (a diferencia del
    // SPIN), así que el hover no necesita quitar/recrear nada — solo escala.
    const minusChip = this.mobileRoundChip(minusX, rowY, btnR, 0x0b0f1a, 0.45, 0xffffff, 0.7);
    const minusBtn = this.mobileGlyphButton(minusX, rowY, btnR, "−", () => this.changeBet(-1));
    const plusChip = this.mobileRoundChip(plusX, rowY, btnR, 0x0b0f1a, 0.45, 0xffffff, 0.7);
    const plusBtn = this.mobileGlyphButton(plusX, rowY, btnR, "+", () => this.changeBet(1));
    this.debugTrack("BET- disco (mobileRoundChip)", minusChip);
    this.debugTrack("BET- glifo", minusBtn.txt);
    this.debugTrack("BET+ disco (mobileRoundChip)", plusChip);
    this.debugTrack("BET+ glifo", plusBtn.txt);
    // FASE 4 DESKTOP (punto 1): hover — misma escala leve que el resto.
    for (const [chip, { txt, zone }] of [[minusChip, minusBtn], [plusChip, plusBtn]] as const) {
      zone.on("pointerover", () => this.tweens.add({ targets: [chip, txt], scale: 1.06, duration: 140, ease: "Sine.easeOut" }));
      zone.on("pointerout", () => this.tweens.add({ targets: [chip, txt], scale: 1, duration: 160, ease: "Sine.easeOut" }));
    }
    this.debugRegisterBox("BET-", minusX, rowY, btnR * 2, btnR * 2);
    this.debugRegisterBox("BET+", plusX, rowY, btnR * 2, btnR * 2);

    // ---- Texto de ayuda de turbo (punto 3): discreto, chico, DENTRO de la
    // barra, centrado en el mismo contenedor de ancho máximo que los 3
    // grupos (no en toda la zona segura — así queda centrado respecto al
    // HUD, no respecto a toda la ventana). 12px/60% pedido. Se desvanece
    // solo tras la primera tirada (this.turboHintText, ver onSpin()).
    this.turboHintText = this.add
      .text(barContentX0 + barContentW / 2, barTop + barH * 0.14, "MANTÉN ESPACIO PARA TIRADA TURBO", {
        fontFamily: "Arial, sans-serif",
        fontSize: "12px",
        fontStyle: "bold",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setAlpha(0.6)
      .setDepth(DEPTH.hud);
    this.debugTrack("Texto ayuda turbo", this.turboHintText);
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
    this.winText.setY(this.bannerY);
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
    return this.isMobile ? CONFIG_MOBILE.debug.enabled : CONFIG_DESKTOP.debug.enabled;
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

  // DIAGNÓSTICO D1b (temporal, SOLO escritorio): registra un GameObject real
  // (no un bounding box AABB) con un nombre legible, para poder volcarlo por
  // consola — ver debugDumpObjects(). No dibuja nada ni cambia el objeto; es
  // una referencia aparte. Respeta el mismo flag que el resto del debug
  // (CONFIG_DESKTOP.debug.enabled) — en producción (flag apagado) esto no
  // guarda nada y no cuesta memoria.
  private debugTrack(name: string, obj: Phaser.GameObjects.GameObject) {
    if (!this.debugEnabled) return;
    this.debugObjects.push({ name, obj });
  }

  // DIAGNÓSTICO D1b: vuelca por consola, en una tabla, TODOS los objetos
  // registrados con debugTrack() — nombre, tipo, depth, alpha, visible,
  // posición, tamaño real en pantalla e interactividad. Es la "evidencia"
  // pedida en el PASO 2: con esto se puede ver, objeto por objeto, si algo
  // quedó con un alpha bajo, una posición inesperada, o si directamente no
  // se creó. Solo corre si CONFIG_DESKTOP.debug.enabled es true.
  private debugDumpObjects() {
    if (!this.debugEnabled) return;
    const rows = this.debugObjects.map(({ name, obj }) => {
      const o = obj as unknown as {
        type?: string;
        depth?: number;
        alpha?: number;
        visible?: boolean;
        x?: number;
        y?: number;
        displayWidth?: number;
        displayHeight?: number;
        input?: unknown;
        texture?: { key?: string };
      };
      return {
        nombre: name,
        tipo: o.type ?? obj.constructor.name,
        textura: o.texture?.key ?? "-",
        depth: typeof o.depth === "number" ? o.depth : "-",
        alpha: typeof o.alpha === "number" ? Math.round(o.alpha * 100) / 100 : "-",
        visible: typeof o.visible === "boolean" ? o.visible : "-",
        x: typeof o.x === "number" ? Math.round(o.x) : "-",
        y: typeof o.y === "number" ? Math.round(o.y) : "-",
        ancho: typeof o.displayWidth === "number" ? Math.round(o.displayWidth) : "-",
        alto: typeof o.displayHeight === "number" ? Math.round(o.displayHeight) : "-",
        interactivo: !!o.input,
      };
    });
    // eslint-disable-next-line no-console
    console.log(`DESKTOP_LAYOUT_V2 — volcado de ${rows.length} objetos registrados:`);
    // eslint-disable-next-line no-console
    console.table(rows);
    // Objetos con la textura de resplandor (TEX.glow) que NO se registraron
    // a mano arriba (p. ej. las "rosquillas" ambientales, que se crean en un
    // bucle sin nombre individual) — para no dejar ninguno fuera del
    // diagnóstico del punto (b) ("¿de dónde salen los cuadrados de brillo?").
    const untracked = this.children.list.filter((o) => {
      const img = o as unknown as { texture?: { key?: string } };
      return img.texture?.key === TEX.glow && !this.debugObjects.some((d) => d.obj === o);
    });
    if (untracked.length) {
      // eslint-disable-next-line no-console
      console.log(`DESKTOP_LAYOUT_V2 — además, ${untracked.length} imágenes con TEX.glow sin nombre individual (rosquillas ambientales, destellos de clic, etc.):`);
      // eslint-disable-next-line no-console
      console.table(
        untracked.map((o) => {
          const img = o as unknown as { depth?: number; alpha?: number; x?: number; y?: number; displayWidth?: number; displayHeight?: number };
          return {
            depth: img.depth, alpha: img.alpha, x: Math.round(img.x ?? 0), y: Math.round(img.y ?? 0),
            ancho: Math.round(img.displayWidth ?? 0), alto: Math.round(img.displayHeight ?? 0),
          };
        })
      );
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

  // -------------------------------------------------------------------- //
  // Música                                                                //
  // -------------------------------------------------------------------- //
  private setupMusic() {
    if (this.cache.audio.exists(TEX.musicTrack)) {
      this.music = this.sound.add(TEX.musicTrack, { loop: true, volume: 0.35 });
    }
    // CORRECCIÓN 1 (punto 4): en móvil el ícono de SONIDO ya lo dibuja
    // `buildControlsMobile()` por código (mobileToggleIcon), SIEMPRE — así
    // los 5 íconos quedan parejos aunque el tema no tenga imágenes de
    // música subidas. FASE 3 DESKTOP: mismo criterio — el botón de SONIDO
    // ahora lo dibuja `buildControlsDesktop()` por código. Solo el fallback
    // de ventana angosta no táctil conserva el botón de imagen de siempre.
    if (this.portrait && !this.isMobile && this.textures.exists(TEX.musicOn) && this.textures.exists(TEX.musicOff)) {
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
    this.musicBtn?.setTexture(this.musicMuted ? TEX.musicOff : TEX.musicOn);
    if (this.musicBtn) this.fitImage(this.musicBtn, this.musicR * 2.1, this.musicR * 2.1);
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
    this.winText.setText("");
    this.prizeBannerImg?.setVisible(false);
    this.winGroup?.setVisible(true);
    this.transient.forEach((o) => o.destroy());
    this.transient = [];
    this.winCycleTimer?.remove(false);
    this.winCycleTimer = undefined;
    this.winPulseStops.forEach((stop) => stop());
    this.winPulseStops = [];
    this.reels.forEach((r) => r.setAnticipation(false));
    this.hideMascot(true);
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
    // CORRECCIÓN D2 (punto 3, SOLO ESCRITORIO): el texto de ayuda de turbo
    // se desvanece tras la PRIMERA tirada — en móvil `this.turboHintText`
    // nunca se asigna, así que esto nunca hace nada ahí.
    if (this.turboHintText) {
      this.tweens.add({ targets: this.turboHintText, alpha: 0, duration: 500 });
      this.turboHintText = undefined;
    }

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
      this.fsBadge!.setScale(1.18);
      this.tweens.add({ targets: this.fsBadge, scale: 1, duration: 220, ease: "Back.easeOut" });
    }
  }

  // Tween numérico que va escribiendo "prefix + monto" en un Text (roll-up de
  // ganancia), con un tick sonoro periódico mientras sube.
  // CORRECCIÓN 4 (punto 0): `from` es nuevo y opcional (antes siempre 0) —
  // permite animar un DELTA (p. ej. el crédito de $1,829 a $1,830, no desde
  // $0 cada vez) sin tocar ninguno de los usos existentes (GANASTE/GANANCIA
  // siguen pasando solo `to`, que sigue animando desde 0 igual que siempre).
  private rollUpText(text: Phaser.GameObjects.Text, prefix: string, to: number, duration: number, from = 0) {
    if (to === from) {
      text.setText(prefix + this.money(to));
      return;
    }
    let lastTick = from;
    const step = Math.max(1, Math.abs(to - from) / 14);
    this.tweens.addCounter({
      from,
      to,
      duration,
      ease: "Cubic.easeOut",
      onUpdate: (tw) => {
        const v = tw.getValue() ?? from;
        text.setText(prefix + this.money(Math.round(v)));
        if (Math.abs(v - lastTick) >= step && v !== to) {
          sfx.tick();
          lastTick = v;
        }
      },
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
      // FASE 4 DESKTOP (punto 5): overlay propio para escritorio real — el
      // fallback de ventana angosta no táctil sigue con bigWin() de siempre.
      if (!this.portrait) this.bigWinDesktop(resp, tier);
      else this.bigWin(resp, tier);
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
    this.winText.setText(prefix + this.money(total)).setScale(1);
    const baseW = this.winText.width;
    const baseH = this.winText.height;
    const fit = Math.min(1, this.winMaxW / Math.max(1, baseW));

    if (this.prizeBannerImg) {
      this.prizeBannerImg.setPosition(this.W / 2, this.bannerY).setVisible(true).setScale(1);
      this.fitImage(this.prizeBannerImg, baseW * fit * 1.5 + 40, baseH * fit * 2.6);
    }

    this.winText.setText(prefix + this.money(0));
    this.winText.setScale(fit * 0.6);
    this.tweens.add({ targets: this.winText, scale: fit, duration: 350, ease: "Back.easeOut" });
    this.rollUpText(this.winText, prefix, total, this.turbo ? 320 : 750);
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

  private normalWin(resp: SpinResponse) {
    sfx.win();
    this.winGroup.setVisible(false); // el banner ocupa la zona de GANANCIA
    this.highlightWins(resp);

    // Escala para que NO se desborde de la rejilla: se mide con el monto final y
    // luego se reinicia a 0 para el roll-up (así el tamaño no salta al crecer).
    const total = resp.total_win;
    const prefix = "GANASTE  ";
    this.winText.setText(prefix + this.money(total)).setScale(1);
    const baseW = this.winText.width;
    const baseH = this.winText.height;
    const fit = Math.min(1, this.winMaxW / Math.max(1, baseW));

    // El banner de premio (si se subió) aparece detrás del texto, dimensionado a él.
    if (this.prizeBannerImg) {
      this.prizeBannerImg.setPosition(this.W / 2, this.bannerY).setVisible(true).setScale(1);
      this.fitImage(this.prizeBannerImg, baseW * fit * 1.5 + 40, baseH * fit * 2.6);
    }

    this.winText.setText(prefix + this.money(0));
    this.winText.setScale(fit * 0.6);
    this.tweens.add({ targets: this.winText, scale: fit, duration: 350, ease: "Back.easeOut" });
    this.rollUpText(this.winText, prefix, total, this.turbo ? 320 : 750);
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

  private bigWin(resp: SpinResponse, tier: WinTier) {
    sfx.bigWin();
    this.winGroup.setVisible(false);

    // Antes de oscurecer la pantalla con la celebración, se resaltan las figuras
    // y líneas ganadoras sobre los rieles (igual que en un premio normal) para
    // que el jugador vea QUÉ combinación disparó el big win.
    this.highlightWins(resp);
    const highlightMs = this.turbo ? 250 : 900;
    this.time.delayedCall(highlightMs, () => this.celebrateBigWin(resp, tier));
  }

  private celebrateBigWin(resp: SpinResponse, tier: WinTier) {
    const cfg = SlotScene.TIER_CFG[tier];
    this.cameras.main.shake(cfg.shakeMs, cfg.shakeI);

    // Si el tema trae una mascota de "premio grande" (GIF decodificado o imagen
    // estática), se dibuja DENTRO del canvas con depth entre los rieles y el
    // oscurecido — TODO (mascota, oscurecido, monedas/confeti, texto) a la vez.
    const hasMascot = !!this.mascotFrames || !!this.mascotStaticKey;
    if (hasMascot) this.showMascot(cfg.holdMs + 400);

    const cx = this.W / 2;
    const cy = this.gridY + this.gridH / 2;

    const overlay = this.add
      .rectangle(0, 0, this.W, this.H, 0x000000, 0.68)
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

    const banner = this.add.container(cx, cy).setDepth(30);
    const titleText = this.add
      .text(0, -50, cfg.title, {
        fontFamily: "Arial, sans-serif",
        fontSize: `${Math.round(Math.min(this.W * 0.16, 90))}px`,
        fontStyle: "bold",
        color: cfg.color,
        stroke: "#000000",
        strokeThickness: 8,
      })
      .setOrigin(0.5);
    const amountText = this.add
      .text(0, 40, this.money(0), {
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
    this.rollUpText(amountText, "", resp.total_win, cfg.rollMs);

    this.time.delayedCall(cfg.holdMs, () => {
      this.tweens.add({
        targets: [overlay, banner],
        alpha: 0,
        duration: 400,
        onComplete: () => this.clearTransient(),
      });
    });
  }

  // ====================================================================== //
  // BIG WIN DESKTOP (Fase 4, punto 5) — módulo aislado: solo se llama desde  //
  // present() cuando !portrait (escritorio real). Mismo cálculo/acreditado  //
  // del premio que siempre (ya pasó antes de llamar a present()) — solo     //
  // cómo se anima: texto centrado sobre los rodillos, rayos de luz          //
  // (receta idéntica a celebrateBigWinMobile, con cuidado de dibujar en     //
  // LOCAL + setPosition para poder rotarlos sin desplazarlos), monedas,     //
  // sacudida de cámara, y SALTABLE con clic o ESPACIO. El fallback de       //
  // ventana angosta no táctil sigue usando bigWin()/celebrateBigWin() de    //
  // siempre, sin tocar.                                                     //
  // ====================================================================== //
  private bigWinDesktop(resp: SpinResponse, tier: WinTier) {
    sfx.bigWin();
    this.winGroup.setVisible(false);
    this.highlightWins(resp);
    const highlightMs = this.turbo ? 250 : 900;
    this.time.delayedCall(highlightMs, () => this.celebrateBigWinDesktop(resp, tier));
  }

  // Degradados de 3 tonos por nivel — se reutilizan los de CONFIG_MOBILE
  // (regla 3: "reutiliza los tokens de color del móvil"); el único desajuste
  // es de NOMBRE ("epic" en WinTier vs "super" en móvil, mismo nivel).
  private static readonly DESKTOP_WIN_GRADIENT: Record<WinTier, [string, string, string]> = {
    big: CONFIG_MOBILE.celebration.tiers.big.gradient,
    mega: CONFIG_MOBILE.celebration.tiers.mega.gradient,
    epic: CONFIG_MOBILE.celebration.tiers.super.gradient,
    jackpot: CONFIG_MOBILE.celebration.tiers.jackpot.gradient,
  };

  private celebrateBigWinDesktop(resp: SpinResponse, tier: WinTier) {
    const cfg = SlotScene.TIER_CFG[tier];
    const gradient = SlotScene.DESKTOP_WIN_GRADIENT[tier];
    this.winOverlayActive = true;
    this.cameras.main.shake(cfg.shakeMs, cfg.shakeI);

    const hasMascot = !!this.mascotFrames || !!this.mascotStaticKey;
    if (hasMascot) this.showMascot(cfg.holdMs + 400);

    const cx = this.W / 2;
    const cy = this.gridY + this.gridH / 2;

    // Punto 5: "que se puedan saltar con clic o espacio" — el overlay ya
    // cubre toda la pantalla, así que es la zona de clic. DEPTH: en
    // escritorio el HUD (SPIN, iconos) vive en CONFIG_DESKTOP.depth.hud=30 y
    // arriba — a diferencia de móvil (cuyo HUD no pasa de ~11), un overlay a
    // depth 20 quedaría POR DEBAJO del botón de SPIN: un clic durante la
    // celebración podría disparar un giro nuevo en vez de cerrarla, y
    // onSpin()->clearTransient() destruiría estos objetos sin pasar por
    // `finish()` (dejando `dismissTimer`/`raysTween` corriendo sueltos,
    // apuntando a objetos ya destruidos). Se usa el nivel `overlays` (100),
    // pensado justo para esto — siempre por encima de todo el HUD.
    const OV = CONFIG_DESKTOP.depth.overlays;
    const overlay = this.add
      .rectangle(0, 0, this.W, this.H, 0x000000, 0.68)
      .setOrigin(0)
      .setDepth(OV)
      .setInteractive();
    this.transient.push(overlay);

    // Rayos de luz girando detrás del banner — dibujados en LOCAL (0,0) y
    // luego posicionados con setPosition (si no, el `angle` tweeneado abajo
    // rotaría alrededor del origen de la escena, no del centro del banner).
    const rayColor = hexToNum(cfg.color, 0xffd23f);
    const rays = this.add.graphics().setDepth(OV + 1).setBlendMode(Phaser.BlendModes.ADD);
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
      .setDepth(OV + 5);
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
      .setDepth(OV + 5);
    confetti.explode(cfg.confetti, cx, cy - 60);
    this.transient.push(confetti);

    // Texto centrado SOBRE LOS RODILLOS (punto 5), degradado dorado/propio
    // del nivel + contorno (mismo tratamiento "premium" de Fase 2/3).
    const banner = this.add.container(cx, cy).setDepth(OV + 10);
    const titleText = this.goldGradientText(
      0, -50, cfg.title, Math.round(Math.min(this.W * 0.07, 90)), "#2b1604", gradient
    );
    const amountText = this.goldGradientText(
      0, 50, this.money(0), Math.round(Math.min(this.W * 0.05, 68)), "#2b1604", gradient
    );
    banner.add([titleText, amountText]);
    banner.setScale(0);
    this.transient.push(banner);

    this.tweens.add({ targets: banner, scale: 1, duration: 550, ease: "Back.easeOut" });
    this.tweens.add({ targets: titleText, angle: { from: -4, to: 4 }, duration: 500, yoyo: true, repeat: -1 });
    this.rollUpText(amountText, "", resp.total_win, cfg.rollMs);

    // Saltar con clic O con espacio — se cierra sola a los `holdMs` si no.
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      this.winOverlayActive = false;
      dismissTimer.remove(false);
      raysTween.remove();
      this.input.keyboard?.off("keydown-SPACE", finish);
      this.tweens.add({
        targets: [overlay, banner, rays],
        alpha: 0,
        duration: 300,
        onComplete: () => this.clearTransient(),
      });
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
      .setDepth(9);
    this.transient.push(msg);
    this.time.delayedCall(2500, () => msg.destroy());
  }
}
