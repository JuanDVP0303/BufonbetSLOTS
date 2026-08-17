import Phaser from "phaser";
import { SYMBOLS, SYMBOL_LABEL, SYMBOL_COLOR, TEX } from "./constants";

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
  private size: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    topY: number,
    private colIndex: number,
    rows: number,
    symbolSize: number,
    // Códigos REALES del casino para el desenfoque del giro (los que tienen imagen).
    // Si no se pasan, cae a los símbolos por defecto (evita mostrar placeholders al girar).
    blurPool?: string[]
  ) {
    this.scene = scene;
    this.rows = rows;
    this.size = symbolSize;
    this.container = scene.add.container(x, topY);

    const pool = blurPool && blurPool.length ? blurPool : (SYMBOLS as unknown as string[]);
    for (let i = 0; i < this.L; i++) {
      this.strip.push(Phaser.Utils.Array.GetRandom(pool));
    }

    const frameSize = this.size;
    const artSize = Math.round(this.size * 0.72); // símbolo más pequeño que la casilla
    const fontSize = `${Math.round(this.size * 0.4)}px`;
    for (let i = 0; i < rows + 2; i++) {
      const frame = scene.add.image(0, 0, TEX.cellFrame).setDisplaySize(frameSize, frameSize);
      const bg = scene.add.image(0, 0, TEX.cell).setDisplaySize(artSize, artSize).setVisible(false);
      const sprite = scene.add.image(0, 0, TEX.cell).setDisplaySize(artSize, artSize).setVisible(false);
      const label = scene.add
        .text(0, 0, "", {
          fontFamily: "Arial, sans-serif",
          fontSize,
          fontStyle: "bold",
          color: "#0b0f1a",
        })
        .setOrigin(0.5);
      const cell = scene.add.container(this.size / 2, 0, [frame, bg, sprite, label]);
      this.container.add(cell);
      this.cells.push({ container: cell, frame, bg, sprite, label });
    }

    const maskG = scene.make.graphics({});
    maskG.fillStyle(0xffffff);
    maskG.fillRect(x, topY, this.size, rows * this.size);
    this.container.setMask(maskG.createGeometryMask());

    this.render();
  }

  private setCell(cell: Cell, symbol: string) {
    const texKey = `sym-${symbol}`;
    const art = Math.round(this.size * 0.72);
    if (this.scene.textures.exists(texKey)) {
      // Encaja la imagen dentro de la casilla conservando su proporción.
      const src = this.scene.textures.get(texKey).getSourceImage();
      const scale = Math.min(art / src.width, art / src.height);
      cell.sprite.setTexture(texKey).setScale(scale).setVisible(true);
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
    const off = (this.position - base) * this.size;
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i];
      cell.container.y = (i - 1) * this.size - off + this.size / 2;
      const symbol = this.strip[(((base + (i - 1)) % this.L) + this.L) % this.L];
      this.setCell(cell, symbol);
    }
  }

  startSpin() {
    this.spinning = true;
  }

  update(dtMs: number) {
    if (!this.spinning) return;
    this.position += (this.speed * dtMs) / 1000;
    if (this.position >= this.L) this.position -= this.L;
  }

  stop(target: string[], delayMs: number, durationMs = 650): Promise<void> {
    this.spinning = false;
    const base = Math.floor(this.position);
    const s = base + 6 + this.colIndex * 3;
    for (let r = 0; r < this.rows; r++) {
      this.strip[(((s + r) % this.L) + this.L) % this.L] = target[r];
    }
    return new Promise((resolve) => {
      this.scene.tweens.add({
        targets: this,
        position: s,
        duration: durationMs,
        delay: delayMs,
        ease: "Cubic.easeOut",
        onComplete: () => {
          this.position = s % this.L;
          this.render();
          resolve();
        },
      });
    });
  }

  cellCenter(row: number): { x: number; y: number } {
    return {
      x: this.container.x + this.size / 2,
      y: this.container.y + row * this.size + this.size / 2,
    };
  }
}
