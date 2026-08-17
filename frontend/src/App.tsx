import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import LoginPage from "./pages/LoginPage";
import LobbyPage from "./pages/LobbyPage";
import PlayPage from "./pages/PlayPage";
import EmbedPage from "./pages/EmbedPage";
import MasterPage from "./pages/MasterPage";
import MasterCasinosPage from "./pages/MasterCasinosPage";
import MasterOperatorsPage from "./pages/MasterOperatorsPage";
import OperatorPortalPage from "./pages/OperatorPortalPage";

/** Entrada única: según sesión/rol, redirige al lobby o al panel del master. */
function Home() {
  const { user, loading } = useAuth();
  if (loading) return <div className="center muted">Cargando…</div>;
  if (!user) return <Navigate to="/login" replace />;
  const home = user.role === "MASTER" ? "/master" : user.role === "OPERATOR" ? "/operator" : "/lobby";
  return <Navigate to={home} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<LoginPage />} />
          {/* Iframe del operador (modo proveedor): público, autenticado por token en la URL. */}
          <Route path="/embed" element={<EmbedPage />} />
          <Route
            path="/lobby"
            element={
              <ProtectedRoute role="PLAYER">
                <LobbyPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/play/:slug"
            element={
              <ProtectedRoute role="PLAYER">
                <PlayPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/master"
            element={
              <ProtectedRoute role="MASTER">
                <MasterPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/master/casinos"
            element={
              <ProtectedRoute role="MASTER">
                <MasterCasinosPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/master/operators"
            element={
              <ProtectedRoute role="MASTER">
                <MasterOperatorsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/operator"
            element={
              <ProtectedRoute role="OPERATOR">
                <OperatorPortalPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
