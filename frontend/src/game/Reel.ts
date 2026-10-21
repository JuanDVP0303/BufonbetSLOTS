import Phaser from "phaser";
import { SYMBOLS, SYMBOL_LABEL, SYMBOL_COLOR, TEX } from "./constants";
import { CONFIG_MOBILE } from "./mobile/configMobile";

interface Cell {
  container: Phaser.GameObjects.Container;
  frame: Phaser.GameObjects.Image; // marco/casilla siempre visible
  bg: Phaser.GameObjects.Image; // fondo de color (solo placeholder)
  sprite: Phaser.GameObjects.Image; // imagen del tema (si el símbolo la tiene)
  label: Phaser.GameObjects.Text;
}

/**
 * Un carrete (columna). Parametrizado por nº de filas y tamaño de símbolo, así
 * sirve para cualquier rejilla (3x3, 5x3, 6x4…). Modelo de "banda virtual":
 * `position` (en símbolos) avanza en el giro y se frena con easeOut sobre el
 * objetivo que envía el servidor.
 */
export class Reel {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private cells: Cell[] = [];
  private strip: string[] = [];
  private readonly L = 64;

  public position = 0;
  public spinning = false;
  private readonly speed = 26;
  private rows: number;
  private size: number; // ANCHO de columna/celda (también usado para el espaciado horizontal)
  private cellH: number; // ALTO de celda — CORRECCIÓN 4: igual a `size` en escritorio (celda
  // cuadrada); en móvil puede ser distinto (celdas 4:5, ver SlotScene.computeLayoutMobile).
  private anticipationOverlay?: Phaser.GameObjects.Image;
  private anticipationTween?: Phaser.Tweens.Tween;

  // SOLO MÓVIL (Fase 4): estado del arranque (tirón hacia atrás + rampa de
  // aceleración) y de turbo/anticipación, usados únicamente en update()/stop()
  // cuando `this.mobile` es true. Desktop nunca toca estos campos.
  private rampElapsed = 0;
  private inPullBack = false;
  private turboActive = false;
  private anticipationActive = false;

  constructor(
    scene: Phaser.Scene,
    x: number,
    topY: number,
    private colIndex: number,
    rows: number,
    symbolSize: number,
    // Códigos REALES del casino para el desenfoque del giro (los que tienen imagen).
    // Si no se pasan, cae a los símbolos por defecto (evita mostrar placeholders al girar).
    blurPool?: string[],
    // SOLO MÓVIL (Fase 2 — ver SlotScene.buildReels): sin el marco/casilla gris
    // por celda (los símbolos "flotan" sobre el panel compartido) y con un
    // sombreado/brillo suave en el arte. Escritorio no pasa estos flags y
    // queda exactamente como antes.
    private flatCells = false,
    private symbolFx = false,
    // SOLO MÓVIL (Fase 4): activa la aceleración/frenado/turbo/anticipación
    // nuevos (ver CONFIG_MOBILE.reel). Desktop no lo pasa y sigue exactamente
    // como antes (velocidad fija, frenado con overshoot fijo, sin blur).
    private mobile = false,
    // CORRECCIÓN 4 (punto 3, SOLO MÓVIL): alto de celda, si es distinto del
    // ancho (`symbolSize`) — celdas 4:5 en vez de cuadradas. Por defecto es
    // igual a `symbolSize` (celda cuadrada): escritorio no pasa este
    // parámetro y queda exactamente como antes.
    cellH: number = symbolSize
  ) {
    this.scene = scene;
    this.rows = rows;
    this.size = symbolSize;
    this.cellH = cellH;
    this.container = scene.add.container(x, topY);

    const pool = blurPool && blurPool.length ? blurPool : (SYMBOLS as unknown as string[]);
    for (let i = 0; i < this.L; i++) {
      this.strip.push(Phaser.Utils.Array.GetRandom(pool));
    }

    const frameW = this.size;
    const frameH = this.cellH;
    // CORRECCIÓN 2 (punto 2, SOLO MÓVIL): 88% pedido — el fallback de ventana
    // angosta no táctil conserva el 90% de siempre. CORRECCIÓN 4 (punto 3):
    // ancho y alto de encaje POR SEPARADO (celda ya no es necesariamente
    // cuadrada). FASE 2 DESKTOP (punto 6): escritorio real también pasa a
    // 88% — usa `symbolFx` (true en móvil Y en escritorio real, ver
    // buildReels en SlotScene.ts), no `this.mobile` (que solo controla la
    // FÍSICA del giro, sin relación con el tamaño de encaje del símbolo).
    const artRatio = this.symbolFx ? 0.82 : 0.9;
    const artW = Math.round(this.size * artRatio);
    const artH = Math.round(this.cellH * artRatio);
    const fontSize = `${Math.round(Math.min(this.size, this.cellH) * 0.4)}px`;
    for (let i = 0; i < rows + 2; i++) {
      const frame = scene.add
        .image(0, 0, TEX.cellFrame)
        .setDisplaySize(frameW, frameH)
        .setVisible(!this.flatCells); // móvil: sin cuadro gris, el símbolo flota
      const bg = scene.add.image(0, 0, TEX.cell).setDisplaySize(artW, artH).setVisible(false);
      const sprite = scene.add.image(0, 0, TEX.cell).setDisplaySize(artW, artH).setVisible(false);
      const label = scene.add
        .text(0, 0, "", {
          fontFamily: "Arial, sans-serif",
          fontSize,
          fontStyle: "bold",
          color: "#0b0f1a",
        })
        .setOrigin(0.5);
      if (this.symbolFx) {
        // CORRECCIÓN 2 (punto 2): antes había un `addGlow` BLANCO alrededor
        // del símbolo — exactamente el "borde blanco tipo pegatina" que se
        // pidió quitar. Se reemplaza por un halo OSCURO muy fino (actúa como
        // outline de contacto) + la sombra suave de siempre. preFX es de
        // Phaser 3.60+: se aplica una sola vez por sprite, no en cada setCell.
        sprite.preFX?.addShadow(0, 0.06, 0.04, 1, 0x000000, 6, 0.5);
        sprite.preFX?.addGlow(0x1a0f05, 0.5, 0, false, 0.08, 4);
        label.setShadow(0, 3, "#000000", 5, true, true);
      }
      const cell = scene.add.container(this.size / 2, 0, [frame, bg, sprite, label]);
      this.container.add(cell);
      this.cells.push({ container: cell, frame, bg, sprite, label });
    }

    const maskG = scene.make.graphics({});
    maskG.fillStyle(0xffffff);
    maskG.fillRect(x, topY, this.size, rows * this.cellH);
    this.container.setMask(maskG.createGeometryMask());

    this.render();
  }

  private setCell(cell: Cell, symbol: string) {
    const texKey = `sym-${symbol}`;
    const artRatio = this.symbolFx ? 0.82 : 0.9;
    const artW = Math.round(this.size * artRatio);
    const artH = Math.round(this.cellH * artRatio);
    if (this.scene.textures.exists(texKey)) {
      const src = this.scene.textures.get(texKey).getSourceImage();
      // CORRECCIÓN 4 (punto 3, SOLO MÓVIL): "normaliza todos los símbolos a
      // la misma altura visual" — en vez de encajar cada imagen por su lado
      // más chico (ancho O alto, lo que dé un símbolo más chico — lo que ya
      // hacía que Marge/Bart/Lisa se vieran de tamaños distintos según la
      // proporción de CADA imagen), se escala SIEMPRE por la altura. Si algún
      // símbolo queda más ancho que la celda, la máscara de la columna lo
      // recorta por los costados — se prioriza la altura pareja, como se pidió.
      // CORRECCIÓN 6 (punto 8) + CORRECCIÓN 7 (punto 5): igualar solo la
      // ALTURA no basta — un personaje angosto (p. ej. Marge, con el pelo
      // alto y angosto) ocupa menos ÁREA que uno más ancho aunque mida lo
      // mismo de alto, y se percibe más chico. `areaFit` escala por el ÁREA
      // (ancho×alto) en vez de solo la altura, usando como referencia un
      // símbolo "cuadrado" que llena `artH` (para uno ya cuadrado o ancho,
      // `areaFit <= heightFit`, así que `Math.max` no cambia nada — coincide
      // exacto con el comportamiento de la Corrección 4). Para uno angosto,
      // `areaFit > heightFit`: se deja crecer más allá de `artH`. El primer
      // tope (Corrección 6) era `cellH` exacto —matemáticamente seguro, pero
      // demasiado conservador: en la práctica seguía recortando casi todo el
      // impulso del área para Marge (se notó "sigue angosta, pero menos").
      // Se amplía un 10% más allá de `cellH`: el margen entre celdas casi
      // siempre tiene algo de relleno transparente propio en el PNG (los
      // sprites rara vez están recortados a cuadro exacto), así que ese 10%
      // extra normalmente cae en ese relleno antes de tocar al vecino de
      // verdad. FASE 2 DESKTOP (punto 6): escritorio real también normaliza
      // por área ahora — `symbolFx` (no `this.mobile`, que es solo la física
      // del giro) es true en móvil Y en escritorio real; el fallback de
      // ventana angosta no táctil sigue con el ajuste por el lado más chico.
      const heightFit = artH / src.height;
      const areaFit = artH / Math.sqrt(src.width * src.height);
      const maxFit = (this.cellH * 1.1) / src.height;
      const fitScale = this.symbolFx
        ? Math.min(Math.max(heightFit, areaFit), maxFit)
        : Math.min(artW / src.width, artH / src.height);
      // SOLO MÓVIL (Fase 4, regla 2): mientras gira, "desenfoque falso" — se
      // estira el símbolo en Y y se le baja el alpha (no hay sprite -blur por
      // símbolo todavía). Reutiliza el mismo `sprite` de siempre: no crea
      // objetos nuevos por frame. Al detenerse (this.spinning=false) vuelve a
      // su forma normal en el siguiente render().
      const blur = this.mobile && this.spinning;
      const sy = blur ? CONFIG_MOBILE.reel.blurScaleY : 1;
      cell.sprite
        .setTexture(texKey)
        .setScale(fitScale, fitScale * sy)
        .setAlpha(blur ? CONFIG_MOBILE.reel.blurAlpha : 1)
        .setVisible(true);
      cell.bg.setVisible(false);
      cell.label.setVisible(false);
    } else {
      cell.bg.setVisible(true).setTint(SYMBOL_COLOR[symbol] ?? 0xffffff);
      cell.label.setVisible(true).setText(SYMBOL_LABEL[symbol] ?? symbol);
      cell.label.setColor(symbol === "WILD" ? "#7a4f00" : "#0b0f1a");
      cell.sprite.setVisible(false);
    }
  }

  render() {
    const base = Math.floor(this.position);
    // CORRECCIÓN 4: el desplazamiento vertical es por ALTO de celda, no por
    // ancho (antes usaba `this.size` para ambos ejes, invisible mientras la
    // celda era cuadrada — con celdas 4:5 esto habría girado "raro").
    const off = (this.position - base) * this.cellH;
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i];
      cell.container.y = (i - 1) * this.cellH - off + this.cellH / 2;
      const symbol = this.strip[(((base + (i - 1)) % this.L) + this.L) % this.L];
      this.setCell(cell, symbol);
    }
  }

  startSpin() {
    this.spinning = true;
    if (this.mobile) {
      // SOLO MÓVIL (Fase 4, regla 1): reinicia el tirón hacia atrás + rampa de
      // aceleración cada vez que arranca un giro nuevo.
      this.rampElapsed = 0;
      this.inPullBack = CONFIG_MOBILE.reel.pullBackMs > 0;
    }
  }

  // SOLO MÓVIL (Fase 4): activa/desactiva la velocidad de turbo (se llama
  // antes de `startSpin`). Desktop nunca lee `turboActive`.
  setTurbo(on: boolean) {
    this.turboActive = on;
  }

  update(dtMs: number) {
    if (!this.spinning) return;

    if (!this.mobile) {
      // ESCRITORIO: exactamente como antes — velocidad fija, sin rampas.
      this.position += (this.speed * dtMs) / 1000;
      if (this.position >= this.L) this.position -= this.L;
      return;
    }

    // SOLO MÓVIL (Fase 4, regla 1): tirón hacia atrás breve (velocidad
    // negativa que se suaviza a 0) y luego aceleración suave hasta la
    // velocidad crucero (más rápida en turbo). El giro en curso siempre
    // llega a velocidad completa; solo cambia CÓMO se llega, no el resultado.
    const cfg = CONFIG_MOBILE.reel;
    this.rampElapsed += dtMs;
    let speedFactor: number;
    if (this.inPullBack) {
      const t = Math.min(1, this.rampElapsed / Math.max(1, cfg.pullBackMs));
      speedFactor = -0.3 * (1 - t);
      if (t >= 1) {
        this.inPullBack = false;
        this.rampElapsed = 0;
      }
    } else {
      speedFactor = Math.min(1, this.rampElapsed / Math.max(1, cfg.accelMs));
    }
    const cruise = cfg.cruiseSpeed * (this.turboActive ? cfg.turboCruiseSpeedMult : 1);
    const anticipationMult = this.anticipationActive ? cfg.anticipationSpeedMult : 1;
    this.position += (cruise * anticipationMult * speedFactor * dtMs) / 1000;
    if (this.position >= this.L) this.position -= this.L;
    if (this.position < 0) this.position += this.L;
  }

  // Frenado con rebote: primero se pasa un poco del objetivo (overshoot, como si el
  // peso del carrete siguiera un instante) y luego se asienta suavemente, en vez de
  // frenar en seco. Al terminar, un golpe de "impacto" (squash) da sensación de peso.
  stop(target: string[], delayMs: number, durationMs = 650): Promise<void> {
    this.spinning = false;
    const base = Math.floor(this.position);
    const s = base + 6 + this.colIndex * 3;
    for (let r = 0; r < this.rows; r++) {
      this.strip[(((s + r) % this.L) + this.L) % this.L] = target[r];
    }
    // SOLO MÓVIL (Fase 4, regla 4): en turbo el carrete casi no se "pasa" del
    // objetivo (overshoot chico) — así el frenado se ve seco/rápido, sin el
    // rebote marcado del giro normal. Escritorio conserva el 0.3 fijo de siempre.
    const overshoot = this.mobile && this.turboActive ? CONFIG_MOBILE.reel.turboOvershoot : 0.3;
    const phase1 = Math.round(durationMs * 0.72);
    const phase2 = Math.max(90, durationMs - phase1);
    return new Promise((resolve) => {
      this.scene.tweens.add({
        targets: this,
        position: s + overshoot,
        duration: phase1,
        delay: delayMs,
        ease: "Cubic.easeOut",
        onComplete: () => {
          this.scene.tweens.add({
            targets: this,
            position: s,
            duration: phase2,
            ease: "Sine.easeOut",
            onComplete: () => {
              this.position = s % this.L;
              this.render();
              this.bounceImpact();
              resolve();
            },
          });
        },
      });
    });
  }

  private bounceImpact() {
    // SOLO MÓVIL (Fase 4, regla 4): "sin rebote exagerado" en turbo — squash
    // casi imperceptible. Escritorio y el móvil normal usan el golpe de
    // siempre (0.92).
    const squashY = this.mobile && this.turboActive ? CONFIG_MOBILE.reel.turboSquashY : 0.92;
    this.container.setScale(1, squashY);
    this.scene.tweens.add({
      targets: this.container,
      scaleX: 1,
      scaleY: 1,
      duration: 160,
      ease: "Back.easeOut",
    });
  }

  // Aro dorado pulsante mientras el carrete sigue girando (se activa/desactiva desde
  // la escena cuando faltan pocos carretes por frenar y ya hay scatters en camino).
  setAnticipation(on: boolean) {
    // SOLO MÓVIL (Fase 4, regla 5): además del aro dorado ya existente, el
    // carrete en anticipación gira más lento (ver el multiplicador en update()).
    this.anticipationActive = this.mobile && on;
    if (on) {
      if (!this.anticipationOverlay) {
        const h = this.rows * this.cellH;
        this.anticipationOverlay = this.scene.add
          .image(this.size / 2, h / 2, TEX.glow)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setTint(0xffd23f)
          .setDisplaySize(this.size * 1.5, h * 1.2)
          .setDepth(6);
        this.container.add(this.anticipationOverlay);
      }
      this.anticipationTween?.remove();
      this.anticipationOverlay.setVisible(true).setAlpha(0.25);
      this.anticipationTween = this.scene.tweens.add({
        targets: this.anticipationOverlay,
        alpha: 0.8,
        duration: 260,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    } else {
      this.anticipationTween?.remove();
      this.anticipationTween = undefined;
      this.anticipationOverlay?.setVisible(false);
    }
  }

  // Pulso continuo sobre una celda ganadora. Devuelve una función para
  // apagarlo cuando la escena limpia el estado de la victoria. `color`
  // (nuevo parámetro, opcional — los llamadores de escritorio no lo pasan,
  // así que siguen con el dorado de siempre, CERO cambio ahí) es el color de
  // esa combinación ganadora (ver SlotScene.winColorFor) — SOLO lo usa la
  // rama móvil nueva, de abajo.
  pulseCell(row: number, color: number = 0xffe066): () => void {
    const cell = this.cells[row + 1];
    if (!cell) return () => {};
    // Tamaño UNIFORME (no `size`×`cellH` por separado): en escritorio la celda
    // es cuadrada (size===cellH), así que esto no cambia nada ahí — en móvil
    // la celda es 4:5 (CONFIG_MOBILE.grid.cellAspectHW), y estirar un círculo
    // a un rectángulo no cuadrado lo convierte en una elipse que, con blend
    // ADD y tan oversized, se leía como "un cuadro más claro" detrás del
    // símbolo en vez de un resplandor redondo — se usa el lado MÁS CHICO de
    // la celda para que el glow siga siendo un círculo limpio en los dos modos.
    const glowSize = Math.min(this.size, this.cellH) * 1.3;

    // REORGANIZACIÓN móvil (pedido explícito): sin "bounce" (nada de escalar
    // el contenedor) — el símbolo queda QUIETO; solo "alumbra" (resplandor
    // que respira en alpha, no en tamaño) + una ESTELA que gira alrededor,
    // en el color de esa combinación. Escritorio/fallback: rama de abajo,
    // SIN TOCAR (bounce + glow dorado fijo de siempre).
    if (this.mobile) {
      // CORRECCIÓN (pedido, captura): glow/estela van DIRECTO a la escena
      // (no dentro de `cell.container`) con un depth explícito alto — antes,
      // al vivir dentro de la celda (profundidad implícita 0, como todo
      // símbolo), la estela se escondía detrás de la celda VECINA cada vez
      // que giraba más allá del borde de "su" celda (contenedores hermanos
      // se dibujan en orden de inserción, no por superposición real). Así
      // queda SIEMPRE por encima de todos los símbolos, sin importar hacia
      // dónde gire. `cellCenter(row)` da la posición absoluta real.
      // CORRECCIÓN (pedido): circunferencia más chica — tamaño PROPIO para
      // móvil (no el `glowSize` de escritorio, de abajo, que no se toca).
      const center = this.cellCenter(row);
      const mobileGlowSize = Math.min(this.size, this.cellH) * 1.0;
      const glow = this.scene.add
        .image(center.x, center.y, TEX.glow)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(color)
        .setDisplaySize(mobileGlowSize, mobileGlowSize)
        .setAlpha(0.4)
        .setDepth(6);
      const glowTween = this.scene.tweens.add({
        targets: glow,
        alpha: 0.2,
        duration: 700,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });

      // Estela: un arco corto que se desvanece hacia la "cola" (varios
      // segmentos con alpha decreciente, más GRUESOS que antes — pedido),
      // dibujado una sola vez y luego ROTADO como un todo (Graphics.angle) —
      // así "gira" sin recalcular posiciones cuadro a cuadro.
      const trail = this.scene.add.graphics().setPosition(center.x, center.y).setDepth(7);
      const trailR = mobileGlowSize * 0.5;
      const arcSpanDeg = 80;
      const segs = 14;
      for (let i = 0; i < segs; i++) {
        const a0 = Phaser.Math.DegToRad((i / segs) * arcSpanDeg);
        const a1 = Phaser.Math.DegToRad(((i + 1) / segs) * arcSpanDeg);
        const alpha = 0.85 * (1 - i / segs);
        trail.lineStyle(6, color, alpha);
        trail.beginPath();
        trail.arc(0, 0, trailR, a0, a1);
        trail.strokePath();
      }
      trail.setBlendMode(Phaser.BlendModes.ADD);
      // Pedido: "como un hada volando alegre" — nada de velocidad constante.
      // Se encadenan varios tramos CORTOS con duraciones/eases distintos
      // (uno con rebote, "Back") en vez de una sola vuelta pareja — se nota
      // una vuelta irregular, acelerando y frenando distinto cada tramo.
      // Deltas RELATIVOS ("+=") en vez de ángulos absolutos: así cada tramo
      // suma sobre el valor actual sin importar cuántas vueltas lleva dadas
      // — con un ángulo absoluto (70, 150, 230...) el segundo lap habría
      // animado HACIA ATRÁS (de 360 a 70), un salto brusco en reversa.
      const lap = [
        { angle: "+=70", duration: 260, ease: "Sine.easeIn" },
        { angle: "+=80", duration: 180, ease: "Sine.easeOut" },
        { angle: "+=80", duration: 300, ease: "Back.easeInOut" },
        { angle: "+=70", duration: 160, ease: "Sine.easeIn" },
        { angle: "+=60", duration: 260, ease: "Sine.easeOut" },
      ];
      const trailTween = this.scene.tweens.chain({
        targets: trail,
        loop: -1,
        tweens: lap,
      });

      return () => {
        glowTween.remove();
        // `trailTween` es un TweenChain, no un Tween — su `.remove(tween)`
        // es OTRO método (saca UN tramo de la cadena, recibe el tramo como
        // argumento) y habría roto en tiempo de ejecución al llamarlo sin
        // argumentos. `.destroy()` sí es el "parar y limpiar todo" que hace
        // falta acá (mismo efecto práctico que `.remove()` en un Tween normal).
        trailTween.destroy();
        glow.destroy();
        trail.destroy();
      };
    }

    const glow = this.scene.add
      .image(0, 0, TEX.glow)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(color)
      .setDisplaySize(glowSize, glowSize)
      .setAlpha(0.55);
    cell.container.add(glow); // encima del marco/símbolo: destello dorado visible (ADD)
    const scaleTween = this.scene.tweens.add({
      targets: cell.container,
      scale: 1.12,
      duration: 380,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
    const glowTween = this.scene.tweens.add({
      targets: glow,
      alpha: 0.15,
      duration: 380,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
    return () => {
      scaleTween.remove();
      glowTween.remove();
      cell.container.setScale(1);
      glow.destroy();
    };
  }

  // Pulso único y sutil (sin glow) para la animación de reposo (idle).
  idlePulse() {
    const row = Phaser.Math.Between(0, this.rows - 1);
    const cell = this.cells[row + 1];
    if (!cell) return;
    this.scene.tweens.add({
      targets: cell.container,
      scale: 1.08,
      duration: 220,
      yoyo: true,
      ease: "Sine.easeInOut",
    });
  }

  // Usado SOLO por el HUD móvil (Fase 5) para atenuar los símbolos que NO
  // ganaron mientras se muestra una victoria. Genérico e inofensivo para
  // escritorio: simplemente nunca se llama desde ahí.
  setCellAlpha(row: number, alpha: number) {
    const cell = this.cells[row + 1];
    if (cell) cell.container.setAlpha(alpha);
  }

  cellCenter(row: number): { x: number; y: number } {
    return {
      x: this.container.x + this.size / 2,
      y: this.container.y + row * this.cellH + this.cellH / 2,
    };
  }
}
