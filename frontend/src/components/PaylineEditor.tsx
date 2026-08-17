import { useEffect, useMemo, useState } from "react";

/**
 * Editor visual de líneas de pago. El usuario hace clic en UNA casilla por columna
 * para trazar una línea (horizontal, diagonal, zigzag, V…). Cada línea es un array
 * de longitud `cols` con la fila elegida en cada rodillo: [fila_col0, fila_col1, …].
 */
interface Props {
  cols: number;
  rows: number;
  lines: number[][];
  onChange: (lines: number[][]) => void;
  accent?: string;
}

const CELL = 40;
const GAP = 6;
const center = (i: number) => i * (CELL + GAP) + CELL / 2;

function polyPoints(line: number[]): string {
  return line
    .map((r, c) => (r < 0 ? null : `${center(c)},${center(r)}`))
    .filter(Boolean)
    .join(" ");
}

// Líneas por defecto (igual que el backend): horizontales + 2 diagonales.
function defaultLines(cols: number, rows: number): number[][] {
  const out: number[][] = [];
  for (let r = 0; r < rows; r++) out.push(Array(cols).fill(r));
  if (rows >= 2) {
    const down = Array.from({ length: cols }, (_, c) => Math.min(c, rows - 1));
    const up = Array.from({ length: cols }, (_, c) => Math.max(rows - 1 - c, 0));
    for (const d of [down, up]) if (!out.some((l) => l.join() === d.join())) out.push(d);
  }
  return out;
}

export function PaylineEditor({ cols, rows, lines, onChange, accent = "#ffd23f" }: Props) {
  const [cur, setCur] = useState<number[]>(() => Array(cols).fill(-1));

  // Al cambiar el tamaño de la grilla, se reinicia la línea en edición.
  useEffect(() => {
    setCur(Array(cols).fill(-1));
  }, [cols, rows]);

  const gridW = cols * CELL + (cols - 1) * GAP;
  const gridH = rows * CELL + (rows - 1) * GAP;
  const complete = useMemo(() => cur.length === cols && cur.every((r) => r >= 0), [cur, cols]);

  const toggle = (c: number, r: number) =>
    setCur((prev) => {
      const n = prev.length === cols ? [...prev] : Array(cols).fill(-1);
      n[c] = n[c] === r ? -1 : r;
      return n;
    });

  const addLine = () => {
    if (!complete) return;
    if (lines.some((l) => l.join() === cur.join())) {
      setCur(Array(cols).fill(-1));
      return; // ya existe, no duplicar
    }
    onChange([...lines, [...cur]]);
    setCur(Array(cols).fill(-1));
  };

  return (
    <div className="pl-editor">
      <div className="pl-main">
        <div className="pl-grid-wrap" style={{ width: gridW, height: gridH }}>
          <div
            className="pl-grid"
            style={{ gridTemplateColumns: `repeat(${cols}, ${CELL}px)`, gap: GAP }}
          >
            {Array.from({ length: rows }).map((_, r) =>
              Array.from({ length: cols }).map((_, c) => (
                <button
                  type="button"
                  key={`${c}-${r}`}
                  className={`pl-cell ${cur[c] === r ? "on" : ""}`}
                  style={{ gridColumn: c + 1, gridRow: r + 1, ...(cur[c] === r ? { background: accent } : {}) }}
                  onClick={() => toggle(c, r)}
                />
              ))
            )}
          </div>
          <svg className="pl-svg" width={gridW} height={gridH}>
            {complete && (
              <polyline points={polyPoints(cur)} fill="none" stroke={accent} strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
            )}
          </svg>
        </div>

        <div className="pl-side">
          <p className="muted pl-hint">Haz clic en una casilla por columna para trazar la línea.</p>
          <div className="pl-actions">
            <button type="button" className="btn primary btn-small" disabled={!complete} onClick={addLine}>+ Añadir línea</button>
            <button type="button" className="btn ghost btn-small" onClick={() => setCur(Array(cols).fill(-1))}>Limpiar</button>
            <button type="button" className="btn ghost btn-small" onClick={() => onChange(defaultLines(cols, rows))}>Líneas por defecto</button>
            {lines.length > 0 && (
              <button type="button" className="btn ghost btn-small" onClick={() => onChange([])}>Quitar todas</button>
            )}
          </div>
          <p className="muted">{lines.length} línea(s) definida(s){lines.length === 0 ? " — se usarán las de por defecto" : ""}</p>
        </div>
      </div>

      {lines.length > 0 && (
        <div className="pl-lines">
          {lines.map((l, i) => (
            <div className="pl-chip" key={i} title={l.join(",")}>
              <MiniLine cols={cols} rows={rows} line={l} accent={accent} />
              <button type="button" className="link" onClick={() => onChange(lines.filter((_, k) => k !== i))}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniLine({ cols, rows, line, accent }: { cols: number; rows: number; line: number[]; accent: string }) {
  const c = 12, g = 2;
  const cx = (i: number) => i * (c + g) + c / 2;
  const w = cols * c + (cols - 1) * g;
  const h = rows * c + (rows - 1) * g;
  return (
    <svg width={w} height={h} className="pl-mini">
      {Array.from({ length: rows }).map((_, r) =>
        Array.from({ length: cols }).map((_, col) => (
          <rect key={`${col}-${r}`} x={col * (c + g)} y={r * (c + g)} width={c} height={c} rx={2}
            fill={line[col] === r ? accent : "#22304f"} />
        ))
      )}
      <polyline points={line.map((r, col) => `${cx(col)},${cx(r)}`).join(" ")} fill="none" stroke={accent} strokeWidth={2} />
    </svg>
  );
}
