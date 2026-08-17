import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { launch, playSpin, Theme, Paytable } from "../api/play";
import SlotGameCanvas from "../components/SlotGameCanvas";
import { PaytableModal } from "../components/PaytableModal";
import type { SpinResponse } from "../api/spinApi";

export default function PlayPage() {
  const { slug = "" } = useParams();
  const { token, logout } = useAuth();
  const nav = useNavigate();
  const [session, setSession] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme | null>(null);
  const [grid, setGrid] = useState<{ cols: number; rows: number } | null>(null);
  const [balance, setBalance] = useState(0);
  const [bet, setBet] = useState(100); // se sobreescribe con la apuesta del casino
  const [betInfo, setBetInfo] = useState<{ min: number; max: number; levels: number[] }>({
    min: 1,
    max: 1_000_000,
    levels: [],
  });
  const [currency, setCurrency] = useState("USD");
  const [curSymbol, setCurSymbol] = useState("$");
  const [curExponent, setCurExponent] = useState(2);
  const [paytable, setPaytable] = useState<Paytable | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setSession(null);
    async function boot() {
      try {
        const r = await launch(token!, slug);
        if (active) {
          setSession(r.game_session);
          setTheme(r.theme);
          setGrid(r.grid);
          setBalance(r.balance);
          setBet(r.bet.default);
          setBetInfo({ min: r.bet.min, max: r.bet.max, levels: r.bet.levels });
          setCurrency(r.currency);
          setCurSymbol(r.currency_detail?.symbol ?? "$");
          setCurExponent(r.currency_detail?.exponent ?? 2);
          setPaytable(r.paytable);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "No se pudo cargar el juego");
      }
    }
    boot();
    return () => {
      active = false;
    };
  }, [token, slug]);

  const spin = async (bet: number): Promise<SpinResponse> => {
    const r = await playSpin(token!, session!, bet);
    if (typeof r.balance === "number") setBalance(r.balance);
    return r;
  };

  return (
    <div className="play-shell">
      {/* HUD mínimo flotante (nav del cliente independiente; se oculta en iframe).
          El saldo/apuesta viven DENTRO del juego, en la barra inferior. */}
      <header className="hud hud-float">
        <button className="btn ghost hud-icon" onClick={() => nav("/lobby")} title="Lobby">
          ←
        </button>
        <div className="hud-actions">
          <button
            className="btn ghost hud-icon"
            onClick={() => setShowHelp(true)}
            title="Combinaciones ganadoras"
            disabled={!paytable}
          >
            ?
          </button>
          <button className="btn ghost hud-icon" onClick={logout} title="Salir">
            ⏻
          </button>
        </div>
      </header>
      <main className="play-canvas-wrap">
        {error && <div className="center error">{error}</div>}
        {!error && !session && <div className="center muted">Cargando juego…</div>}
        {session && (
          <SlotGameCanvas
            key={slug}
            spin={spin}
            betAmount={bet}
            onBalance={setBalance}
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
    </div>
  );
}
