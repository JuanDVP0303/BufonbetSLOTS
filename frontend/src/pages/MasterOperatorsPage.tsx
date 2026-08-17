import { FormEvent, useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { CurrencyInfo, listCurrencies } from "../api/master";
import {
  ApiKeyRow,
  NewApiKey,
  OperatorGameRow,
  OperatorPlays,
  OperatorRow,
  OperatorPlayer,
  OperatorSpin,
  OperatorUserRow,
  OperatorsReport,
  Paginated,
  assignOperatorGame,
  createOperator,
  createOperatorKey,
  createOperatorUser,
  getOperatorPlayers,
  getOperatorPlays,
  getOperatorSpins,
  getOperatorsReport,
  listOperatorGames,
  listOperatorKeys,
  listOperatorUsers,
  listOperators,
  setOperatorUserPassword,
} from "../api/operators";
import { MasterNav } from "../components/MasterNav";
import { Modal } from "../components/Modal";
import { Pager } from "../components/Pager";

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

type Tab = "overview" | "keys" | "catalog" | "spins" | "players" | "access";

export default function MasterOperatorsPage() {
  const { token } = useAuth();
  const [operators, setOperators] = useState<OperatorRow[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyInfo[]>([]);
  const [report, setReport] = useState<OperatorsReport | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState<string | null>(null);

  // Detalle del operador seleccionado.
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [users, setUsers] = useState<OperatorUserRow[]>([]);
  const [games, setGames] = useState<OperatorGameRow[]>([]);
  const [plays, setPlays] = useState<OperatorPlays | null>(null);
  const [spins, setSpins] = useState<Paginated<OperatorSpin> | null>(null);
  const [spinsPage, setSpinsPage] = useState(1);
  const [playersList, setPlayersList] = useState<Paginated<OperatorPlayer> | null>(null);
  const [playersPage, setPlayersPage] = useState(1);
  const [freshKey, setFreshKey] = useState<NewApiKey | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  // Modales de cuentas: crear cuenta / cambiar contraseña.
  const [accountModal, setAccountModal] = useState(false);
  const [pwModal, setPwModal] = useState<OperatorUserRow | null>(null);

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

  const loadOperators = useCallback(async () => {
    try {
      setOperators(await listOperators(token!));
      setCurrencies(await listCurrencies(token!));
      setReport(await getOperatorsReport(token!));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
    }
  }, [token]);
  useEffect(() => { loadOperators(); }, [loadOperators]);

  const loadDetail = useCallback(async (code: string) => {
    setFreshKey(null);
    try {
      setKeys(await listOperatorKeys(token!, code));
      setUsers(await listOperatorUsers(token!, code));
      setGames(await listOperatorGames(token!, code));
      setPlays(await getOperatorPlays(token!, code));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar el operador");
    }
  }, [token]);
  useEffect(() => { if (selected) { setSpinsPage(1); loadDetail(selected); } }, [selected, loadDetail]);

  const loadSpins = useCallback(async (code: string, page: number) => {
    try {
      setSpins(await getOperatorSpins(token!, code, page, 25));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar giros");
    }
  }, [token]);
  useEffect(() => {
    if (selected && tab === "spins") loadSpins(selected, spinsPage);
  }, [selected, tab, spinsPage, loadSpins]);

  const loadPlayers = useCallback(async (code: string, page: number) => {
    try {
      setPlayersList(await getOperatorPlayers(token!, code, page, 25));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar jugadores");
    }
  }, [token]);
  useEffect(() => {
    if (selected && tab === "players") loadPlayers(selected, playersPage);
  }, [selected, tab, playersPage, loadPlayers]);

  async function create(e: FormEvent) {
    e.preventDefault();
    const code = slugify(name);
    if (!code) return;
    try {
      await createOperator(token!, { name, code });
      setName(""); setShowCreate(false);
      await loadOperators();
      setSelected(code); setTab("overview");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al crear el operador");
    }
  }

  async function genKey() {
    if (!selected) return;
    const label = prompt("Etiqueta para la clave (ej. prod, staging):") ?? "";
    try {
      const nk = await createOperatorKey(token!, selected, label);
      setFreshKey(nk);
      setKeys(await listOperatorKeys(token!, selected));
      await loadOperators();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al generar la clave");
    }
  }

  async function submitAccount(email: string, password: string) {
    if (!selected) return;
    await createOperatorUser(token!, selected, email, password);
    setUsers(await listOperatorUsers(token!, selected));
    setAccountModal(false);
  }

  async function submitPassword(password: string) {
    if (!selected || !pwModal) return;
    await setOperatorUserPassword(token!, selected, pwModal.id, password);
    setPwModal(null);
  }

  async function toggleGame(g: OperatorGameRow) {
    if (!selected) return;
    const enable = !(g.assigned && g.is_enabled);
    try {
      await assignOperatorGame(token!, selected, g.slug, enable);
      setGames(await listOperatorGames(token!, selected));
      await loadOperators();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al asignar el juego");
    }
  }

  const selOp = operators.find((o) => o.code === selected) || null;
  const grand = report?.grand_total_usd;
  // GGR/tiros por operador (del reporte global consolidado en USD).
  const reportByCode = new Map((report?.operators ?? []).map((r) => [r.code, r]));
  const selReport = selected ? reportByCode.get(selected) : undefined;
  const walletBadge = (mode: string) =>
    mode === "SEAMLESS"
      ? <span className="badge ok">Seamless (dinero real)</span>
      : <span className="badge">Demo (fun-money)</span>;

  return (
    <div className="master-shell">
      <MasterNav />
      <main className="master-main">
        <div className="dash-head">
          <div>
            <h1 className="dash-title">Operadores</h1>
            <p className="muted">Casinos que consumen el catálogo por API. Datos aislados por operador.</p>
          </div>
          <button className="btn primary" onClick={() => setShowCreate((s) => !s)}>+ Nuevo operador</button>
        </div>
        {error && <p className="error">{error}</p>}

        {showCreate && (
          <section className="card">
            <form onSubmit={create} className="inline-create">
              <label className="field">
                <span>Nombre del operador</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Casino Luna" required autoFocus />
              </label>
              <span className="field slug-hint">código: {slugify(name) || "—"}</span>
              <p className="muted op-multicur">Multimoneda: la moneda la decide el operador en cada launch (MXN, USD, CLP…).</p>
              <button className="btn primary" disabled={!name}>Crear operador</button>
            </form>
          </section>
        )}

        {/* Tarjetas globales en USD */}
        {grand && (
          <div className="stat-cards">
            <div className="stat-card accent">
              <span className="stat-k">GGR global (USD)</span>
              <span className="stat-v">{fmtUsd(grand.ggr)}</span>
            </div>
            <div className="stat-card">
              <span className="stat-k">Apostado (USD)</span>
              <span className="stat-v">{fmtUsd(grand.bet)}</span>
            </div>
            <div className="stat-card">
              <span className="stat-k">Pagado (USD)</span>
              <span className="stat-v">{fmtUsd(grand.win)}</span>
            </div>
            <div className="stat-card">
              <span className="stat-k">Operadores · Tiros</span>
              <span className="stat-v">{operators.length} · {grand.spins.toLocaleString()}</span>
            </div>
          </div>
        )}

        <div className="dash-grid">
          {/* Lista de operadores */}
          <aside className="card op-sidebar">
            <div className="card-head"><h2>Operadores</h2></div>
            <ul className="op-items">
              {operators.map((o) => (
                <li key={o.code}>
                  <button
                    className={`op-item ${selected === o.code ? "active" : ""}`}
                    onClick={() => { setSelected(o.code); setTab("overview"); }}
                  >
                    <span className="op-avatar">{o.name.slice(0, 1).toUpperCase()}</span>
                    <span className="op-item-txt">
                      <span className="op-name">{o.name}</span>
                      <span className="op-meta muted">{o.players} jugadores · {o.games} juegos · {o.keys} claves</span>
                      <span className="op-meta muted">
                        {o.wallet_mode === "SEAMLESS" ? "● seamless" : "○ demo"}
                        {reportByCode.get(o.code) ? ` · GGR ${fmtUsd(reportByCode.get(o.code)!.usd.ggr)}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {operators.length === 0 && <li className="muted op-empty">Sin operadores. Crea el primero.</li>}
            </ul>
          </aside>

          {/* Detalle */}
          <div className="op-detail">
            {!selOp ? (
              <div className="card center muted op-placeholder">Selecciona un operador para ver su back office.</div>
            ) : (
              <>
                <div className="op-detail-head">
                  <div className="op-avatar big">{selOp.name.slice(0, 1).toUpperCase()}</div>
                  <div className="op-detail-id">
                    <h2>{selOp.name} {walletBadge(selOp.wallet_mode)}</h2>
                    <p className="muted">
                      código <code>{selOp.code}</code> · alta {new Date(selOp.created_at).toLocaleDateString()}
                      {selOp.wallet_base_url ? <> · billetera <code>{selOp.wallet_base_url}</code></> : ""}
                    </p>
                  </div>
                </div>

                {/* Tarjetas de datos clave del operador */}
                <div className="stat-cards op-stat-cards">
                  <div className="stat-card">
                    <span className="stat-k">Jugadores</span>
                    <span className="stat-v">{selOp.players.toLocaleString()}</span>
                  </div>
                  <div className="stat-card">
                    <span className="stat-k">Juegos · Claves</span>
                    <span className="stat-v">{selOp.games} · {selOp.keys}</span>
                  </div>
                  <div className="stat-card">
                    <span className="stat-k">Tiros</span>
                    <span className="stat-v">{selReport ? selReport.spins.toLocaleString() : "0"}</span>
                  </div>
                  <div className="stat-card accent">
                    <span className="stat-k">GGR (USD)</span>
                    <span className="stat-v">{selReport ? fmtUsd(selReport.usd.ggr) : fmtUsd(0)}</span>
                  </div>
                </div>

                <div className="tabs">
                  <button className={`tab ${tab === "overview" ? "active" : ""}`} onClick={() => setTab("overview")}>Resumen</button>
                  <button className={`tab ${tab === "players" ? "active" : ""}`} onClick={() => setTab("players")}>Jugadores</button>
                  <button className={`tab ${tab === "spins" ? "active" : ""}`} onClick={() => setTab("spins")}>Giros</button>
                  <button className={`tab ${tab === "catalog" ? "active" : ""}`} onClick={() => setTab("catalog")}>Catálogo</button>
                  <button className={`tab ${tab === "keys" ? "active" : ""}`} onClick={() => setTab("keys")}>API keys</button>
                  <button className={`tab ${tab === "access" ? "active" : ""}`} onClick={() => setTab("access")}>Accesos</button>
                </div>

                {/* RESUMEN */}
                {tab === "overview" && (
                  <section className="card">
                    <div className="card-head"><h2>Resumen por moneda</h2><span className="muted">datos aislados de este operador</span></div>
                    {plays && plays.by_currency.length > 0 ? (
                      <>
                        <div className="ggr-row">
                          {plays.by_currency.map((t) => (
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
                            <span className="ggr-ggr">{fmtUsd(plays.usd.ggr)}</span>
                            <span className="muted">GGR consolidado</span>
                            <span className="muted">apostado {fmtUsd(plays.usd.bet)}</span>
                            <span className="muted">pagado {fmtUsd(plays.usd.win)}</span>
                            {plays.usd_missing_rate.length > 0 && (
                              <span className="warn-rate">sin tasa: {plays.usd_missing_rate.join(", ")}</span>
                            )}
                          </div>
                        </div>
                      </>
                    ) : (
                      <p className="muted">Aún no hay jugadas de este operador.</p>
                    )}
                  </section>
                )}

                {/* GIROS (paginado) */}
                {tab === "spins" && (
                  <section className="card">
                    <div className="card-head"><h2>Giros</h2><span className="muted">del más reciente al más antiguo</span></div>
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
                      <Pager page={spins.page} totalPages={spins.total_pages} total={spins.total} onPage={setSpinsPage} />
                    )}
                  </section>
                )}

                {/* JUGADORES */}
                {tab === "players" && (
                  <section className="card">
                    <div className="card-head"><h2>Jugadores</h2><span className="muted">importes en la moneda del jugador · USD consolidado aparte</span></div>
                    <div className="table-wrap">
                      <table className="pro-table">
                        <thead>
                          <tr><th>Jugador</th><th>Tiros</th><th>Apostado</th><th>Pagado</th><th>GGR</th><th>GGR (USD)</th></tr>
                        </thead>
                        <tbody>
                          {playersList?.results.map((p) => (
                            <tr key={p.player}>
                              <td><b>{p.player}</b></td>
                              <td>{p.spins}</td>
                              <td>
                                {p.by_currency.length === 0 && <span className="muted">—</span>}
                                {p.by_currency.map((c) => (
                                  <div key={c.currency}>{fmtMoney(c.bet, c.currency)}</div>
                                ))}
                              </td>
                              <td>
                                {p.by_currency.map((c) => (
                                  <div key={c.currency} className={c.win > 0 ? "win" : ""}>{fmtMoney(c.win, c.currency)}</div>
                                ))}
                              </td>
                              <td>
                                {p.by_currency.map((c) => (
                                  <div key={c.currency} className="ggr-cell">{fmtMoney(c.ggr, c.currency)}</div>
                                ))}
                              </td>
                              <td className="muted">
                                {fmtUsd(p.usd.ggr)}
                                {p.usd_missing_rate.length > 0 && (
                                  <div className="warn-rate">sin tasa: {p.usd_missing_rate.join(", ")}</div>
                                )}
                              </td>
                            </tr>
                          ))}
                          {playersList && playersList.results.length === 0 && (
                            <tr><td colSpan={6} className="muted">Sin jugadores todavía.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    {playersList && (
                      <Pager page={playersList.page} totalPages={playersList.total_pages} total={playersList.total} onPage={setPlayersPage} />
                    )}
                  </section>
                )}

                {/* CATÁLOGO */}
                {tab === "catalog" && (
                  <section className="card">
                    <div className="card-head"><h2>Catálogo asignado</h2><span className="muted">marca qué juegos puede ofrecer</span></div>
                    <div className="op-games">
                      {games.map((g) => {
                        const on = g.assigned && g.is_enabled;
                        return (
                          <button key={g.slug} className={`op-game ${on ? "on" : ""}`} onClick={() => toggleGame(g)}>
                            <span className="tick">{on ? "✓" : "+"}</span>
                            <span className="op-game-name">{g.title}</span>
                            <span className="muted">{g.grid.cols}×{g.grid.rows} · {g.win_mode}</span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                )}

                {/* API KEYS */}
                {tab === "keys" && (
                  <section className="card">
                    <div className="card-head">
                      <h2>API keys</h2>
                      <button className="btn ghost btn-small" onClick={genKey}>+ Generar clave</button>
                    </div>
                    {freshKey && (
                      <div className="key-reveal">
                        <b>Copia esta clave ahora — no se vuelve a mostrar:</b>
                        <code>{freshKey.api_key}</code>
                      </div>
                    )}
                    {keys.length === 0 ? (
                      <p className="muted">Sin claves. Genera una para que el operador pueda llamar a la API.</p>
                    ) : (
                      <div className="table-wrap">
                        <table className="pro-table">
                          <thead><tr><th>Prefijo</th><th>Etiqueta</th><th>Último uso</th><th>Estado</th></tr></thead>
                          <tbody>
                            {keys.map((k) => (
                              <tr key={k.prefix}>
                                <td><code>{k.prefix}…</code></td>
                                <td>{k.label || "—"}</td>
                                <td className="muted">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "nunca"}</td>
                                <td>{k.is_active ? <span className="badge ok">activa</span> : <span className="badge">revocada</span>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                )}

                {/* ACCESOS (cuentas de login del back office del operador) */}
                {tab === "access" && (
                  <section className="card">
                    <div className="card-head">
                      <h2>Cuentas de acceso</h2>
                      <button className="btn ghost btn-small" onClick={() => setAccountModal(true)}>+ Nueva cuenta</button>
                    </div>
                    <p className="muted">Con estas credenciales el operador entra a su back office (en /login) y ve SOLO sus datos.</p>
                    {users.length === 0 ? (
                      <p className="muted">Sin cuentas. Crea una para dar acceso al operador.</p>
                    ) : (
                      <div className="table-wrap">
                        <table className="pro-table">
                          <thead><tr><th>Email</th><th></th></tr></thead>
                          <tbody>
                            {users.map((u) => (
                              <tr key={u.id}>
                                <td>{u.email}</td>
                                <td className="ta-right">
                                  <button className="btn small" onClick={() => setPwModal(u)}>Cambiar contraseña</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                )}
              </>
            )}
          </div>
        </div>

        {accountModal && (
          <CredentialsModal
            title="Nueva cuenta de operador"
            withEmail
            submitLabel="Crear cuenta"
            onClose={() => setAccountModal(false)}
            onSubmit={(email, pw) => submitAccount(email!, pw)}
          />
        )}
        {pwModal && (
          <CredentialsModal
            title={`Cambiar contraseña · ${pwModal.email}`}
            submitLabel="Guardar contraseña"
            onClose={() => setPwModal(null)}
            onSubmit={(_e, pw) => submitPassword(pw)}
          />
        )}
      </main>
    </div>
  );
}

/** Modal de credenciales: contraseña (y email opcional). Valida en cliente. */
function CredentialsModal({
  title, withEmail, submitLabel, onClose, onSubmit,
}: {
  title: string;
  withEmail?: boolean;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (email: string | undefined, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr(null);
    if (withEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setErr("Email inválido."); return; }
    if (password.length < 6) { setErr("La contraseña debe tener al menos 6 caracteres."); return; }
    setBusy(true);
    try {
      await onSubmit(withEmail ? email : undefined, password);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      {withEmail && (
        <label>
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ops@operador.com" autoFocus />
        </label>
      )}
      <label>
        <span>Contraseña</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="mín. 6 caracteres" autoFocus={!withEmail} />
      </label>
      {err && <p className="modal-err">{err}</p>}
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn primary" onClick={submit} disabled={busy}>{busy ? "Guardando…" : submitLabel}</button>
      </div>
    </Modal>
  );
}
