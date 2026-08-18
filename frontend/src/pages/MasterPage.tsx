import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import {
  AuditRow,
  CurrencyInfo,
  Paginated,
  PlayerRow,
  creditPlayer,
  listAudit,
  listCurrencies,
  listPlayers,
} from "../api/master";
import { OperatorRow, listOperators } from "../api/operators";
import { MasterNav } from "../components/MasterNav";
import { Pager } from "../components/Pager";

const money = (m: number) => `$${(m / 100).toFixed(2)}`;
const fmt = (iso: string) => new Date(iso).toLocaleString();
const PAGE_SIZE = 25;
const PAGE_SIZES = [5, 10, 25, 50, 100];

const RESULT_LABEL: Record<AuditRow["result"], string> = {
  win: "Ganada",
  loss: "Perdida",
  neutral: "Neutra",
};

export default function MasterPage() {
  const { token } = useAuth();
  const [players, setPlayers] = useState<Paginated<PlayerRow> | null>(null);
  const [audit, setAudit] = useState<Paginated<AuditRow> | null>(null);
  const [playersPage, setPlayersPage] = useState(1);
  const [auditPage, setAuditPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // #2: los jugadores internos son SOLO de prueba → sección plegable (oculta por defecto).
  const [showPlayers, setShowPlayers] = useState(false);
  // #3: filtros de auditoría — rango de fechas + tamaño de página + jugador/operador/resultado/moneda.
  const [auditSize, setAuditSize] = useState(25);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [playerQuery, setPlayerQuery] = useState("");
  const [playerFilter, setPlayerFilter] = useState(""); // valor con debounce
  const [operatorFilter, setOperatorFilter] = useState("");
  const [resultFilter, setResultFilter] = useState<"" | "win" | "loss" | "neutral">("");
  const [currencyFilter, setCurrencyFilter] = useState("");
  const [operators, setOperators] = useState<OperatorRow[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyInfo[]>([]);

  // Catálogos para los desplegables de filtro (una sola vez).
  useEffect(() => {
    if (!token) return;
    listOperators(token).then(setOperators).catch(() => {});
    listCurrencies(token).then(setCurrencies).catch(() => {});
  }, [token]);

  // Debounce del buscador de jugador para no lanzar una petición por tecla.
  useEffect(() => {
    const t = setTimeout(() => setPlayerFilter(playerQuery.trim()), 350);
    return () => clearTimeout(t);
  }, [playerQuery]);

  // Formatea importes en su propia moneda (respeta el exponente: USD/MXN=2, CLP=0).
  const fmtCur = useCallback((minor: number, code: string) => {
    const info = currencies.find((c) => c.code === code);
    const exp = info?.exponent ?? 2;
    const sym = info?.symbol ?? "";
    return `${sym}${(minor / 10 ** exp).toFixed(exp)} ${code}`;
  }, [currencies]);

  const hasAuditFilters = Boolean(
    dateFrom || dateTo || playerFilter || operatorFilter || resultFilter || currencyFilter
  );

  const loadPlayers = useCallback(async (page: number) => {
    try {
      setPlayers(await listPlayers(token!, page, PAGE_SIZE));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar jugadores");
    }
  }, [token]);

  const loadAudit = useCallback(async (page: number) => {
    try {
      setAudit(await listAudit(token!, page, auditSize, {
        from: dateFrom || undefined,
        to: dateTo || undefined,
        player: playerFilter || undefined,
        operator: operatorFilter || undefined,
        result: resultFilter || undefined,
        currency: currencyFilter || undefined,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar auditoría");
    }
  }, [token, auditSize, dateFrom, dateTo, playerFilter, operatorFilter, resultFilter, currencyFilter]);

  useEffect(() => { loadPlayers(playersPage); }, [loadPlayers, playersPage]);
  useEffect(() => { loadAudit(auditPage); }, [loadAudit, auditPage]);
  // Al cambiar filtros/tamaño, vuelve a la página 1.
  useEffect(() => {
    setAuditPage(1);
  }, [auditSize, dateFrom, dateTo, playerFilter, operatorFilter, resultFilter, currencyFilter]);

  function clearAuditFilters() {
    setDateFrom(""); setDateTo(""); setPlayerQuery(""); setPlayerFilter("");
    setOperatorFilter(""); setResultFilter(""); setCurrencyFilter("");
  }

  async function refresh() {
    setBusy(true);
    await Promise.all([loadPlayers(playersPage), loadAudit(auditPage)]);
    setBusy(false);
  }

  async function credit(p: PlayerRow) {
    const input = window.prompt(`Acreditar saldo a ${p.email} (en USD):`, "10.00");
    if (!input) return;
    const dollars = Number(input);
    if (!Number.isFinite(dollars) || dollars <= 0) { alert("Monto inválido"); return; }
    try {
      await creditPlayer(token!, p.id, Math.round(dollars * 100), "crédito manual");
      await loadPlayers(playersPage);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al acreditar");
    }
  }

  return (
    <div className="master-shell">
      <MasterNav />
      <main className="master-main">
        <div className="dash-head">
          <div>
            <h1 className="dash-title">Panel de control</h1>
            <p className="muted">Jugadores internos y auditoría de tiros.</p>
          </div>
          <button className="btn ghost" onClick={refresh} disabled={busy}>↻ Refrescar</button>
        </div>
        {error && <p className="error">{error}</p>}

        {/* Tarjetas de resumen */}
        <div className="stat-cards">
          <div className="stat-card">
            <span className="stat-k">Jugadores</span>
            <span className="stat-v">{players?.total?.toLocaleString() ?? "—"}</span>
          </div>
          <div className="stat-card">
            <span className="stat-k">Tiros auditados</span>
            <span className="stat-v">{audit?.total?.toLocaleString() ?? "—"}</span>
          </div>
        </div>

        <section className="card">
          <div className="card-head">
            <h2>
              Jugadores internos{" "}
              <span className="muted">(solo pruebas · {players?.total ?? 0})</span>
            </h2>
            <button className="btn ghost btn-small" onClick={() => setShowPlayers((v) => !v)}>
              {showPlayers ? "Ocultar ▲" : "Mostrar ▼"}
            </button>
          </div>
          {showPlayers && (
            <>
              <div className="table-wrap">
                <table className="pro-table">
                  <thead>
                    <tr>
                      <th>Email</th><th>Saldo</th><th>Apostado</th><th>Ganado</th><th>Tiros</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {players?.results.map((p) => (
                      <tr key={p.id}>
                        <td>{p.email}</td>
                        <td>{money(p.balance)}</td>
                        <td>{money(p.total_bet)}</td>
                        <td className={p.total_win > 0 ? "win" : ""}>{money(p.total_win)}</td>
                        <td>{p.spins}</td>
                        <td className="ta-right">
                          <button className="btn small" onClick={() => credit(p)}>+ Saldo</button>
                        </td>
                      </tr>
                    ))}
                    {!players && <tr><td colSpan={6} className="muted">Cargando…</td></tr>}
                    {players && players.results.length === 0 && (
                      <tr><td colSpan={6} className="muted">Sin jugadores todavía.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {players && (
                <Pager page={players.page} totalPages={players.total_pages} total={players.total}
                  onPage={setPlayersPage} busy={busy} />
              )}
            </>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Auditoría de tiros</h2>
            <span className="muted">Log inmutable, del más reciente al más antiguo.</span>
          </div>
          <div className="filter-row">
            <label className="field">
              <span>Jugador (id / email)</span>
              <input
                type="search"
                placeholder="Buscar por id de jugador…"
                value={playerQuery}
                onChange={(e) => setPlayerQuery(e.target.value)}
              />
            </label>
            <label className="field sm">
              <span>Operador</span>
              <select value={operatorFilter} onChange={(e) => setOperatorFilter(e.target.value)}>
                <option value="">Todos</option>
                <option value="internal">Interno (propio)</option>
                {operators.map((op) => (
                  <option key={op.code} value={op.code}>{op.name}</option>
                ))}
              </select>
            </label>
            <label className="field sm">
              <span>Resultado</span>
              <select
                value={resultFilter}
                onChange={(e) => setResultFilter(e.target.value as typeof resultFilter)}
              >
                <option value="">Todos</option>
                <option value="win">Ganadas</option>
                <option value="loss">Perdidas</option>
                <option value="neutral">Neutras</option>
              </select>
            </label>
            <label className="field sm">
              <span>Moneda</span>
              <select value={currencyFilter} onChange={(e) => setCurrencyFilter(e.target.value)}>
                <option value="">Todas</option>
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>{c.code}</option>
                ))}
              </select>
            </label>
            <label className="field sm">
              <span>Desde</span>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label className="field sm">
              <span>Hasta</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
            <label className="field sm">
              <span>Mostrar</span>
              <select value={auditSize} onChange={(e) => setAuditSize(Number(e.target.value))}>
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            {hasAuditFilters && (
              <button className="btn ghost btn-small" onClick={clearAuditFilters}>
                Limpiar filtros
              </button>
            )}
          </div>
          <div className="table-wrap">
            <table className="pro-table">
              <thead>
                <tr>
                  <th>#</th><th>Jugador</th><th>Operador</th><th>Casino</th>
                  <th className="ta-right">Apuesta</th><th className="ta-right">Premio</th>
                  <th className="ta-right">Neto</th><th>Resultado</th><th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {audit?.results.map((a) => (
                  <tr key={a.sequence_number}>
                    <td className="muted">{a.sequence_number}</td>
                    <td>{a.external_player_id}</td>
                    <td className="muted">{a.operator ?? "—"}</td>
                    <td className="muted">{a.game ?? "—"}</td>
                    <td className="ta-right">{fmtCur(a.bet_amount, a.currency)}</td>
                    <td className={`ta-right ${a.win_amount > 0 ? "win" : ""}`}>
                      {fmtCur(a.win_amount, a.currency)}
                    </td>
                    <td className={`ta-right ${a.net_amount > 0 ? "win" : a.net_amount < 0 ? "loss-txt" : "muted"}`}>
                      {a.net_amount > 0 ? "+" : ""}{fmtCur(a.net_amount, a.currency)}
                    </td>
                    <td><span className={`res-badge ${a.result}`}>{RESULT_LABEL[a.result]}</span></td>
                    <td className="muted">{fmt(a.recorded_at)}</td>
                  </tr>
                ))}
                {!audit && <tr><td colSpan={9} className="muted">Cargando…</td></tr>}
                {audit && audit.results.length === 0 && (
                  <tr><td colSpan={9} className="muted">Sin tiros para estos filtros.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {audit && (
            <Pager page={audit.page} totalPages={audit.total_pages} total={audit.total}
              onPage={setAuditPage} busy={busy} />
          )}
        </section>
      </main>
    </div>
  );
}
