import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import {
  AuditRow,
  Paginated,
  PlayerRow,
  creditPlayer,
  listAudit,
  listPlayers,
} from "../api/master";
import { MasterNav } from "../components/MasterNav";
import { Pager } from "../components/Pager";

const money = (m: number) => `$${(m / 100).toFixed(2)}`;
const fmt = (iso: string) => new Date(iso).toLocaleString();
const PAGE_SIZE = 25;
const PAGE_SIZES = [5, 10, 25, 50, 100];

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
  // #3: filtros de auditoría — rango de fechas + tamaño de página.
  const [auditSize, setAuditSize] = useState(25);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const loadPlayers = useCallback(async (page: number) => {
    try {
      setPlayers(await listPlayers(token!, page, PAGE_SIZE));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar jugadores");
    }
  }, [token]);

  const loadAudit = useCallback(async (page: number) => {
    try {
      setAudit(await listAudit(token!, page, auditSize, dateFrom || undefined, dateTo || undefined));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar auditoría");
    }
  }, [token, auditSize, dateFrom, dateTo]);

  useEffect(() => { loadPlayers(playersPage); }, [loadPlayers, playersPage]);
  useEffect(() => { loadAudit(auditPage); }, [loadAudit, auditPage]);
  // Al cambiar filtros/tamaño, vuelve a la página 1.
  useEffect(() => { setAuditPage(1); }, [auditSize, dateFrom, dateTo]);

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
            {(dateFrom || dateTo) && (
              <button className="btn ghost btn-small" onClick={() => { setDateFrom(""); setDateTo(""); }}>
                Limpiar fechas
              </button>
            )}
          </div>
          <div className="table-wrap">
            <table className="pro-table">
              <thead>
                <tr><th>#</th><th>Jugador</th><th>Apuesta</th><th>Premio</th><th>Moneda</th><th>Fecha</th></tr>
              </thead>
              <tbody>
                {audit?.results.map((a) => (
                  <tr key={a.sequence_number}>
                    <td className="muted">{a.sequence_number}</td>
                    <td>{a.external_player_id}</td>
                    <td>{money(a.bet_amount)}</td>
                    <td className={a.win_amount > 0 ? "win" : ""}>{money(a.win_amount)}</td>
                    <td className="muted">{a.currency}</td>
                    <td className="muted">{fmt(a.recorded_at)}</td>
                  </tr>
                ))}
                {!audit && <tr><td colSpan={6} className="muted">Cargando…</td></tr>}
                {audit && audit.results.length === 0 && (
                  <tr><td colSpan={6} className="muted">Sin tiros todavía.</td></tr>
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
