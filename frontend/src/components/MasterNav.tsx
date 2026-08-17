import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

/** Barra superior del área del master: navegación entre secciones + salir. */
export function MasterNav() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const cls = (p: string) => (pathname === p ? "navlink active" : "navlink");
  return (
    <header className="hud">
      <span className="brand-badge"><span className="brand-dot">◆</span> Bufonbet</span>
      <span className="hud-user muted">· {user?.email}</span>
      <nav className="master-nav">
        <Link className={cls("/master")} to="/master">
          Jugadores
        </Link>
        <Link className={cls("/master/casinos")} to="/master/casinos">
          Casinos
        </Link>
        <Link className={cls("/master/operators")} to="/master/operators">
          Operadores
        </Link>
      </nav>
      <button className="btn ghost" onClick={logout}>
        Salir
      </button>
    </header>
  );
}
