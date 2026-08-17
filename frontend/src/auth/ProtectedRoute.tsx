import { ReactElement } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import type { Role } from "../api/auth";

/** Protege una ruta: exige sesión y, opcionalmente, un rol concreto. */
export function ProtectedRoute({ role, children }: { role?: Role; children: ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center muted">Cargando…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) {
    const home = user.role === "MASTER" ? "/master" : user.role === "OPERATOR" ? "/operator" : "/lobby";
    return <Navigate to={home} replace />;
  }
  return children;
}
