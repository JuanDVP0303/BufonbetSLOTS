import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { listLobby, LobbyGame } from "../api/play";

export default function LobbyPage() {
  const { token, user, logout } = useAuth();
  const nav = useNavigate();
  const [games, setGames] = useState<LobbyGame[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listLobby(token!)
      .then((g) => active && setGames(g))
      .catch((e) => active && setError(e instanceof Error ? e.message : "Error al cargar"));
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <div className="lobby-shell">
      <header className="hud">
        <span className="brand-mini">🎰 SlotHub</span>
        <div className="hud-actions">
          <span className="hud-user">{user?.email}</span>
          <button className="btn ghost btn-small" onClick={logout}>
            Salir
          </button>
        </div>
      </header>
      <main className="lobby-main">
        <div className="lobby-head">
          <h1>Elige tu juego</h1>
          <p className="muted">Selecciona un casino para empezar a jugar</p>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="lobby-grid">
          {games.map((g) => (
            <button
              key={g.slug}
              className="lobby-card"
              onClick={() => nav(`/play/${g.slug}`)}
              style={{ ["--card-bg" as string]: g.background_color || "#141a2e" }}
            >
              <div className="lobby-thumb">
                {g.thumbnail ? <img src={g.thumbnail} alt={g.title} /> : <span>🎰</span>}
                <span className={`lobby-badge ${g.win_mode === "WAYS" ? "ways" : "lines"}`}>
                  {g.win_mode === "WAYS" ? "243 WAYS" : "LÍNEAS"}
                </span>
              </div>
              <div className="lobby-info">
                <div className="lobby-title">{g.title}</div>
                <div className="muted lobby-meta">
                  {g.grid.cols}×{g.grid.rows}
                </div>
              </div>
              <span className="lobby-play">Jugar ▸</span>
            </button>
          ))}
          {games.length === 0 && !error && <p className="muted">No hay casinos disponibles.</p>}
        </div>
      </main>
    </div>
  );
}
