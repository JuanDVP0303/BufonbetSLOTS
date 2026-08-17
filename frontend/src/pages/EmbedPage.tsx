import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { embedSpin, embedState } from "../api/embed";
import { Paytable, Theme } from "../api/play";
import SlotGameCanvas from "../components/SlotGameCanvas";
import { PaytableModal } from "../components/PaytableModal";
import { ApiError } from "../api/client";
import type { SpinResponse } from "../api/spinApi";

/**
 * Página del IFRAME (modo proveedor). El operador embebe:
 *   <iframe src="https://<proveedor>/embed?t=<session_token>">
 * Aquí NO hay login ni navegación: la sesión sale del token, el juego se autocarga
 * desde /embed/state y tira por /embed/spin. Pantalla completa.
 */
export default function EmbedPage() {
  const [params] = useSearchParams();
  const sessionToken = params.get("t") || params.get("token") || "";

  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState<Theme | null>(null);
  const [grid, setGrid] = useState<{ cols: number; rows: number } | null>(null);
  const [balance, setBalance] = useState(0);
  const [bet, setBet] = useState(100);
  const [betInfo, setBetInfo] = useState<{ min: number; max: number; levels: number[] }>({
    min: 1, max: 1_000_000, levels: [],
  });
  const [currency, setCurrency] = useState("USD");
  const [curSymbol, setCurSymbol] = useState("$");
  const [curExponent, setCurExponent] = useState(2);
  const [paytable, setPaytable] = useState<Paytable | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lowBalance, setLowBalance] = useState(false);

  useEffect(() => {
    if (!sessionToken) {
      setError("Falta el token de sesión en la URL del iframe.");
      return;
    }
    let active = true;
    async function boot() {
      try {
        const r = await embedState(sessionToken);
        if (!active) return;
        setTheme(r.theme);
        setGrid(r.grid);
        setBalance(r.balance);
        setBet(r.bet.default);
        setBetInfo({ min: r.bet.min, max: r.bet.max, levels: r.bet.levels });
        setCurrency(r.currency);
        setCurSymbol(r.currency_detail?.symbol ?? "$");
        setCurExponent(r.currency_detail?.exponent ?? 2);
        setPaytable(r.paytable);
        setReady(true);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "No se pudo cargar el juego");
      }
    }
    boot();
    return () => { active = false; };
  }, [sessionToken]);

  const spin = async (amount: number): Promise<SpinResponse> => {
    const r = await embedSpin(sessionToken, amount);
    if (typeof r.balance === "number") setBalance(r.balance);
    return r;
  };

  // Saldo insuficiente (HTTP 402): muestra un modal amable en vez del error rojo del
  // canvas. Devuelve true para que la escena NO pinte su mensaje genérico.
  const handleSpinError = (err: unknown): boolean => {
    if (err instanceof ApiError && (err.status === 402 || err.code === "insufficient_funds")) {
      setLowBalance(true);
      return true;
    }
    return false;
  };

  return (
    <div className="play-shell">
      {/* En iframe solo dejamos el acceso a las combinaciones ganadoras. */}
      <header className="hud hud-float">
        <div className="hud-actions">
          <button
            className="btn ghost hud-icon"
            onClick={() => setShowHelp(true)}
            title="Combinaciones ganadoras"
            disabled={!paytable}
          >
            ?
          </button>
        </div>
      </header>
      <main className="play-canvas-wrap">
        {error && <div className="center error">{error}</div>}
        {!error && !ready && <div className="center muted">Cargando juego…</div>}
        {ready && (
          <SlotGameCanvas
            spin={spin}
            betAmount={bet}
            onBalance={setBalance}
            onSpinError={handleSpinError}
            theme={theme ?? undefined}
            grid={grid ?? undefined}
            balance={balance}
            currency={currency}
            currencySymbol={curSymbol}
            currencyExponent={curExponent}
            betLevels={betInfo.levels}
            betMin={betInfo.min}
            betMax={betInfo.max}
          />
        )}
      </main>
      {showHelp && paytable && (
        <PaytableModal paytable={paytable} onClose={() => setShowHelp(false)} />
      )}
      {lowBalance && (
        <div className="lowbal-overlay" onClick={() => setLowBalance(false)}>
          <div className="lowbal-card" onClick={(e) => e.stopPropagation()}>
            <div className="lowbal-icon">💰</div>
            <h3>Saldo insuficiente</h3>
            <p>No tienes saldo para esta apuesta. Recarga tu cuenta para seguir jugando.</p>
            <p className="lowbal-balance">
              Saldo actual: <b>{curSymbol}{(balance / 10 ** curExponent).toLocaleString(undefined, {
                minimumFractionDigits: curExponent, maximumFractionDigits: curExponent,
              })} {currency}</b>
            </p>
            <button className="btn primary lowbal-btn" onClick={() => setLowBalance(false)}>
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
