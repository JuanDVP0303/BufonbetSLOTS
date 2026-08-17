import { Paytable } from "../api/play";
import { SYMBOL_COLOR, SYMBOL_LABEL } from "../game/constants";

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

/** Modal con la tabla de pagos (combinaciones ganadoras) del casino actual. */
export function PaytableModal({ paytable, onClose }: { paytable: Paytable; onClose: () => void }) {
  const note =
    paytable.win_mode === "WAYS"
      ? `${paytable.lines} formas de ganar · símbolos iguales en rodillos adyacentes desde la izquierda`
      : `${paytable.lines} líneas de pago · símbolos iguales sobre una línea`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Combinaciones ganadoras</h2>
          <button className="btn ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="muted">{note}</p>

        <div className="paytable">
          {paytable.symbols.map((s) => (
            <div className="pt-row" key={s.code}>
              <div className="pt-sym">
                {s.image_url ? (
                  <img src={s.image_url} alt={s.label} />
                ) : (
                  <span
                    className="pt-placeholder"
                    style={{ background: hex(SYMBOL_COLOR[s.code] ?? 0x8d99ae) }}
                  >
                    {SYMBOL_LABEL[s.code] ?? s.code}
                  </span>
                )}
              </div>
              <div className="pt-info">
                <div className="pt-name">
                  {s.label} {s.is_wild && <span className="pt-wild">WILD</span>}
                </div>
                <div className="pt-pays">
                  {s.payouts.length === 0 && <span className="muted">—</span>}
                  {s.payouts.map((p) => (
                    <span key={p.count} className="pt-pay">
                      {p.count}× &nbsp;=&nbsp; <b>×{p.multiplier}</b>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        {paytable.symbols.some((s) => s.is_wild) && (
          <p className="muted">El WILD sustituye a cualquier símbolo para completar combinaciones.</p>
        )}
      </div>
    </div>
  );
}
