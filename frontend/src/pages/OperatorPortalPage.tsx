import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { CurrencyInfo, listCurrencies } from "../api/master";
import { OperatorPlayer, OperatorSpin, Paginated } from "../api/operators";
import {
  MyWebhookSecret,
  OperatorMe,
  getMyOperator,
  getMyOperatorPlayers,
  getMyOperatorSpins,
  getMyWebhookSecret,
} from "../api/operatorPortal";
import { Pager } from "../components/Pager";

/** Back office del OPERADOR: ve SOLO los datos de su propio operador. */
export default function OperatorPortalPage() {
  const { user, token, logout } = useAuth();
  const [me, setMe] = useState<OperatorMe | null>(null);
  const [currencies, setCurrencies] = useState<CurrencyInfo[]>([]);
  const [spins, setSpins] = useState<Paginated<OperatorSpin> | null>(null);
  const [page, setPage] = useState(1);
  const [players, setPlayers] = useState<Paginated<OperatorPlayer> | null>(null);
  const [playersPage, setPlayersPage] = useState(1);
  const [tab, setTab] = useState<"overview" | "players" | "spins">("overview");
  const [secret, setSecret] = useState<MyWebhookSecret | null>(null);
  const [revealSecret, setRevealSecret] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const curMap = new Map(currencies.map((c) => [c.code, c]));
  const fmtMoney = (minor: number, code: string) => {
    const c = curMap.get(code);
    const exp = c?.exponent ?? 2;
    const value = minor / 10 ** exp;
    return `${c?.symbol ?? ""}${value.toLocaleString(undefined, {
      minimumFractionDigits: exp, maximumFractionDigits: exp,
    })} ${code}`;
  };
  const fmtUsd = (v: number) =>
    `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const load = useCallback(async () => {
    try {
      setMe(await getMyOperator(token!));
      setCurrencies(await listCurrencies(token!));
      setSecret(await getMyWebhookSecret(token!));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
    }
  }, [token]);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard puede fallar en http; el operador copia a mano */
    }
  }
  useEffect(() => { load(); }, [load]);

  const loadSpins = useCallback(async (p: number) => {
    try {
      setSpins(await getMyOperatorSpins(token!, p, 25));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar giros");
    }
  }, [token]);
  useEffect(() => { if (tab === "spins") loadSpins(page); }, [tab, page, loadSpins]);

  const loadPlayers = useCallback(async (p: number) => {
    try {
      setPlayers(await getMyOperatorPlayers(token!, p, 25));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar jugadores");
    }
  }, [token]);
  useEffect(() => { if (tab === "players") loadPlayers(playersPage); }, [tab, playersPage, loadPlayers]);

  return (
    <div className="master-shell">
      <header className="hud">
        <span className="hud-user">Operador · {me?.name ?? user?.email}</span>
        <button className="btn ghost" style={{ marginLeft: "auto" }} onClick={logout}>Salir</button>
      </header>
      <main className="master-main">
        <div className="dash-head">
          <div>
            <h1 className="dash-title">{me?.name ?? "Mi operador"}</h1>
            <p className="muted">Back office — tus jugadores y tus resultados.</p>
          </div>
        </div>
        {error && <p className="error">{error}</p>}

        {me && (
          <div className="stat-cards">
            <div className="stat-card accent">
              <span className="stat-k">GGR (USD)</span>
              <span className="stat-v">{fmtUsd(me.usd.ggr)}</span>
            </div>
            <div className="stat-card">
              <span className="stat-k">Apostado (USD)</span>
              <span className="stat-v">{fmtUsd(me.usd.bet)}</span>
            </div>
            <div className="stat-card">
              <span className="stat-k">Pagado (USD)</span>
              <span className="stat-v">{fmtUsd(me.usd.win)}</span>
            </div>
          </div>
        )}

        <div className="tabs">
          <button className={`tab ${tab === "overview" ? "active" : ""}`} onClick={() => setTab("overview")}>Resumen</button>
          <button className={`tab ${tab === "players" ? "active" : ""}`} onClick={() => setTab("players")}>Jugadores</button>
          <button className={`tab ${tab === "spins" ? "active" : ""}`} onClick={() => setTab("spins")}>Giros</button>
        </div>

        {tab === "overview" && me && (
          <section className="card">
            <div className="card-head"><h2>Resultados por moneda</h2></div>
            {me.by_currency.length > 0 ? (
              <div className="ggr-row">
                {me.by_currency.map((t) => (
                  <div className="ggr-tile" key={t.currency}>
                    <span className="ggr-cur">{t.currency}</span>
                    <span className="ggr-ggr">{fmtMoney(t.ggr, t.currency)}</span>
                    <span className="muted">GGR · {t.spins} tiros</span>
                    <span className="muted">apostado {fmtMoney(t.bet, t.currency)}</span>
                    <span className="muted">pagado {fmtMoney(t.win, t.currency)}</span>
                  </div>
                ))}
                <div className="ggr-tile usd-tile">
                  <span className="ggr-cur">TOTAL · USD</span>
                  <span className="ggr-ggr">{fmtUsd(me.usd.ggr)}</span>
                  <span className="muted">GGR consolidado</span>
                  <span className="muted">apostado {fmtUsd(me.usd.bet)}</span>
                  <span className="muted">pagado {fmtUsd(me.usd.win)}</span>
                </div>
              </div>
            ) : (
              <p className="muted">Aún no hay jugadas.</p>
            )}
          </section>
        )}

        {tab === "overview" && secret?.configured && (
          <section className="card">
            <div className="card-head">
              <h2>Integración · Firma de webhooks</h2>
              <span className="muted">HMAC-SHA256</span>
            </div>
            <p className="muted">
              Verifica con este secreto la cabecera <code>X-SlotForge-Signature</code> de las
              llamadas a tu billetera (débito/crédito/rollback). Es de solo lectura: si necesitas
              rotarlo, pídelo al proveedor.
            </p>
            <div className="secret-reveal">
              <span className="secret-k">Secreto HMAC</span>
              <div className="secret-val">
                <code>{revealSecret ? secret.secret : "•".repeat(Math.min(secret.secret.length, 40))}</code>
                <button className="btn ghost btn-small" onClick={() => setRevealSecret((v) => !v)}>
                  {revealSecret ? "Ocultar" : "Revelar"}
                </button>
                <button className="btn ghost btn-small" onClick={() => copy(secret.secret)}>Copiar</button>
              </div>
            </div>
            {secret.wallet_base_url && (
              <p className="secret-hint muted">
                Billetera configurada: <code>{secret.wallet_base_url}</code>
              </p>
            )}
          </section>
        )}

        {tab === "players" && (
          <section className="card">
            <div className="card-head"><h2>Tus jugadores</h2><span className="muted">consolidado en USD</span></div>
            <div className="table-wrap">
              <table className="pro-table">
                <thead>
                  <tr><th>Jugador</th><th>Monedas</th><th>Tiros</th><th>Apostado (USD)</th><th>Pagado (USD)</th><th>GGR (USD)</th></tr>
                </thead>
                <tbody>
                  {players?.results.map((p) => (
                    <tr key={p.player}>
                      <td><b>{p.player}</b></td>
                      <td className="muted">{p.currencies.join(", ") || "—"}</td>
                      <td>{p.spins}</td>
                      <td>{fmtUsd(p.usd.bet)}</td>
                      <td>{fmtUsd(p.usd.win)}</td>
                      <td className="ggr-cell">{fmtUsd(p.usd.ggr)}</td>
                    </tr>
                  ))}
                  {players && players.results.length === 0 && (
                    <tr><td colSpan={6} className="muted">Sin jugadores todavía.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {players && (
              <Pager page={players.page} totalPages={players.total_pages} total={players.total} onPage={setPlayersPage} />
            )}
          </section>
        )}

        {tab === "spins" && (
          <section className="card">
            <div className="card-head"><h2>Giros de tus jugadores</h2><span className="muted">del más reciente al más antiguo</span></div>
            <div className="table-wrap">
              <table className="pro-table">
                <thead>
                  <tr><th>Jugador</th><th>Juego</th><th>Apuesta</th><th>Premio</th><th>Fecha</th></tr>
                </thead>
                <tbody>
                  {spins?.results.map((s) => (
                    <tr key={s.spin_id}>
                      <td>{s.player}</td>
                      <td>{s.game}</td>
                      <td>{fmtMoney(s.bet_amount, s.currency)}</td>
                      <td className={s.win_amount > 0 ? "win" : ""}>{fmtMoney(s.win_amount, s.currency)}</td>
                      <td className="muted">{new Date(s.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                  {spins && spins.results.length === 0 && (
                    <tr><td colSpan={5} className="muted">Sin giros todavía.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {spins && (
              <Pager page={spins.page} totalPages={spins.total_pages} total={spins.total} onPage={setPage} />
            )}
          </section>
        )}
      </main>
    </div>
  );
}
